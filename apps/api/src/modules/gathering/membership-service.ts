import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';

export async function decideMembership(
  actorId: string,
  groupId: string,
  membershipId: string,
  decision: 'APPROVE' | 'REJECT',
) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'MEMBER_MANAGE');
  const target = await prisma.gatheringMembership.findFirst({
    where: { id: membershipId, groupId },
  });
  if (!target) throw new AppError(404, 'MEMBER_NOT_FOUND', '참여 요청을 찾을 수 없습니다.');
  if (target.status !== 'PENDING') {
    throw new AppError(409, 'MEMBERSHIP_NOT_PENDING', '승인 대기 상태가 아닙니다.');
  }
  if (decision === 'REJECT') return rejectMembership(actorId, groupId, target.id);
  return approveMembership(actorId, groupId, target.id, target.userId);
}

async function rejectMembership(actorId: string, groupId: string, membershipId: string) {
  await prisma.gatheringMembership.update({
    where: { id: membershipId },
    data: { status: 'REJECTED', approvedAt: new Date(), approvedByUserId: actorId },
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: actorId,
    action: GatheringAuditAction.MEMBER_REJECT,
    targetType: 'GatheringMembership',
    targetId: membershipId,
  });
  return { status: 'REJECTED' as const };
}

async function approveMembership(
  actorId: string,
  groupId: string,
  membershipId: string,
  userId: string,
) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.gatheringMembership.update({
      where: { id: membershipId },
      data: { status: 'ACTIVE', joinedAt: now, approvedAt: now, approvedByUserId: actorId },
    });
    await ensureMemberRole(tx, groupId, membershipId, userId, actorId);
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: GatheringAuditAction.MEMBER_APPROVE,
      targetType: 'GatheringMembership',
      targetId: membershipId,
    });
  });
  return { status: 'ACTIVE' as const };
}

async function ensureMemberRole(
  tx: Prisma.TransactionClient,
  groupId: string,
  membershipId: string,
  userId: string,
  actorId: string,
) {
  const existing = await tx.gatheringRoleAssignment.findFirst({
    where: { membershipId, role: 'MEMBER', revokedAt: null },
  });
  if (existing) return;
  await tx.gatheringRoleAssignment.create({
    data: { groupId, membershipId, userId, role: 'MEMBER', assignedByUserId: actorId },
  });
}
