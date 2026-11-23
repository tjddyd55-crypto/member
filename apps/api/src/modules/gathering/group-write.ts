import type { Prisma } from '@prisma/client';
import {
  STORAGE_QUOTA_BYTES,
  canOpenTrial,
  calendarYearKst,
  calendarYearRange,
  trialWindow,
} from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';
import { getGroupDetail } from './group-read.js';
import { gatheringGroupUpdateSchema, type GatheringGroupScope } from '@member/contracts';
import { lockGroup } from './locks.js';

type GroupInput = { name: string; description?: string } & Partial<GatheringGroupScope>;

export async function createGroup(userId: string, input: GroupInput) {
  const profile = await prisma.gatheringProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new AppError(409, 'PROFILE_REQUIRED', '모임에 쓸 이름과 소속 로컬을 먼저 등록하세요.');
  }
  const groupId = await prisma.$transaction((tx) =>
    insertGroup(tx, userId, profile.directoryConsentAt, input),
  );
  return getGroupDetail(userId, groupId);
}

async function insertGroup(
  tx: Prisma.TransactionClient,
  userId: string,
  consentAt: Date,
  input: GroupInput,
) {
  await validateScope(tx, input);
  const now = new Date();
  const year = calendarYearKst(now);
  const range = calendarYearRange(year);
  const group = await tx.gatheringGroup.create({
    data: {
      name: input.name,
      description: input.description ? input.description : null,
      createdByUserId: userId,
      scopeDistrictId: input.scopeDistrictId,
      scopeLocalId: input.scopeLocalId,
    },
  });
  const membership = await tx.gatheringMembership.create({
    data: {
      groupId: group.id,
      userId,
      status: 'ACTIVE',
      directoryConsentAt: consentAt,
      joinedAt: now,
    },
  });
  await tx.gatheringRoleAssignment.create({
    data: {
      groupId: group.id,
      membershipId: membership.id,
      userId,
      role: 'PRESIDENT',
      assignedByUserId: userId,
    },
  });
  await tx.gatheringExecutiveTerm.create({
    data: { groupId: group.id, userId, role: 'PRESIDENT', fiscalYear: year, startedAt: now },
  });
  await tx.gatheringFinanceYear.create({
    data: {
      groupId: group.id,
      year,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      status: 'OPEN',
      openingBalanceWon: 0,
    },
  });
  await writeGatheringAudit(tx, {
    groupId: group.id,
    actorUserId: userId,
    action: GatheringAuditAction.GROUP_CREATE,
    targetType: 'GatheringGroup',
    targetId: group.id,
  });
  await openTrialIfUnclaimed(tx, userId, group.id, now);
  return group.id;
}

export async function openTrialIfUnclaimed(tx: Prisma.TransactionClient, userId: string, groupId: string, now: Date) {
  const existing = await tx.gatheringTrialClaim.findUnique({ where: { groupId }, select: { id: true } });
  if (!canOpenTrial(existing != null)) return;
  await tx.gatheringTrialClaim.create({ data: { userId, groupId } });
  const window = trialWindow(now);
  const subscription = await tx.gatheringSubscription.create({
    data: {
      groupId,
      status: 'ACTIVE',
      source: 'TRIAL',
      startsAt: window.startsAt,
      expiresAt: window.expiresAt,
      storageQuotaBytes: BigInt(STORAGE_QUOTA_BYTES),
    },
  });
  await tx.gatheringSubscriptionAudit.create({
    data: {
      groupId,
      subscriptionId: subscription.id,
      action: 'TRIAL',
      actorUserId: userId,
      metaJson: JSON.stringify({ expiresAt: window.expiresAt.toISOString() }),
    },
  });
}

export async function updateGroup(userId: string, groupId: string, body: unknown) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'GROUP_SETTINGS');
  if (body && typeof body === 'object' && ('fiscalStartMonth' in body || 'fiscalStartDay' in body)) {
    throw new AppError(400, 'INVALID_PERIOD', '회계연도는 매년 1월 1일부터 12월 31일까지 자동으로 설정됩니다.');
  }
  const input = gatheringGroupUpdateSchema.parse(body);
  await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    if (input.scopeDistrictId !== undefined || input.scopeLocalId !== undefined) {
      const group = await tx.gatheringGroup.findUniqueOrThrow({ where: { id: groupId } });
      await validateScope(tx, {
        scopeDistrictId: input.scopeDistrictId === undefined ? group.scopeDistrictId : input.scopeDistrictId,
        scopeLocalId: input.scopeLocalId === undefined ? group.scopeLocalId : input.scopeLocalId,
      });
    }
    await tx.gatheringGroup.update({ where: { id: groupId }, data: input });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: userId,
      action: GatheringAuditAction.GROUP_UPDATE,
      targetType: 'GatheringGroup',
      targetId: groupId,
    });
  });
  return getGroupDetail(userId, groupId);
}

async function validateScope(tx: Prisma.TransactionClient, { scopeDistrictId, scopeLocalId }: Partial<GatheringGroupScope>) {
  const [district, local] = await Promise.all([
    scopeDistrictId ? tx.district.findUnique({ where: { id: scopeDistrictId }, select: { id: true } }) : null,
    scopeLocalId ? tx.local.findUnique({ where: { id: scopeLocalId }, select: { districtId: true } }) : null,
  ]);
  if ((scopeDistrictId && !district) || (scopeLocalId && !local) ||
      (scopeDistrictId && local && local.districtId !== scopeDistrictId)) {
    throw new AppError(400, 'JC_SCOPE_INVALID', '모임 범위의 지구와 로컬을 확인해 주세요.');
  }
}
