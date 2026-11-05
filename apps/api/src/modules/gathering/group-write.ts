import type { Prisma } from '@prisma/client';
import { fiscalYearOf, fiscalYearRange } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';
import { getGroupDetail } from './group-read.js';

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
  const year = fiscalYearOf(now);
  const range = fiscalYearRange(year);
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
  return group.id;
}

type GroupPatch = {
  name?: string;
  description?: string | null;
  inviteRequiresApproval?: boolean;
};

export async function updateGroup(userId: string, groupId: string, input: GroupPatch) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'GROUP_SETTINGS');
  await prisma.gatheringGroup.update({
    where: { id: groupId },
    data: {
      name: input.name,
      description: input.description,
      inviteRequiresApproval: input.inviteRequiresApproval,
    },
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.GROUP_UPDATE,
    targetType: 'GatheringGroup',
    targetId: groupId,
  });
  return getGroupDetail(userId, groupId);
}
