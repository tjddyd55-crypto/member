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
import { gatheringGroupUpdateSchema } from '@member/contracts';

export async function createGroup(userId: string, input: { name: string; description?: string }) {
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
  input: { name: string; description?: string },
) {
  const now = new Date();
  const year = calendarYearKst(now);
  const range = calendarYearRange(year);
  const group = await tx.gatheringGroup.create({
    data: {
      name: input.name,
      description: input.description ? input.description : null,
      createdByUserId: userId,
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
  if (input.name != null || input.description !== undefined || input.inviteRequiresApproval != null) {
    await prisma.gatheringGroup.update({
      where: { id: groupId },
      data: {
        name: input.name,
        description: input.description,
        inviteRequiresApproval: input.inviteRequiresApproval,
      },
    });
  }
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.GROUP_UPDATE,
    targetType: 'GatheringGroup',
    targetId: groupId,
  });
  return getGroupDetail(userId, groupId);
}
