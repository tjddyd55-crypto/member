import type { Prisma } from '@prisma/client';
import { lockGroup } from './locks.js';
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
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const target = await tx.gatheringMembership.findFirst({ where: { id: membershipId, groupId } });
    if (!target?.userId) throw new AppError(404, 'MEMBER_NOT_FOUND', '참여 요청을 찾을 수 없습니다.');
    if (target.status !== 'PENDING') {
      throw new AppError(409, 'MEMBERSHIP_NOT_PENDING', '승인 대기 상태가 아닙니다.');
    }
    const now = new Date();
    const status = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
    await tx.gatheringMembership.update({
      where: { id: membershipId },
      data: { status, joinedAt: decision === 'APPROVE' ? now : undefined, approvedAt: now, approvedByUserId: actorId },
    });
    if (decision === 'APPROVE') await ensureMemberRole(tx, groupId, membershipId, target.userId, actorId);
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: decision === 'APPROVE' ? GatheringAuditAction.MEMBER_APPROVE : GatheringAuditAction.MEMBER_REJECT,
      targetType: 'GatheringMembership',
      targetId: membershipId,
    });
    return { status };
  });
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
