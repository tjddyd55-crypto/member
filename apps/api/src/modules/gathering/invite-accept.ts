import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';
import { sha256 } from './crypto.js';
import { assertInviteUsable } from './invite-service.js';

export async function acceptGatheringInvite(userId: string, token: string) {
  const profile = await prisma.gatheringProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new AppError(409, 'PROFILE_REQUIRED', '모임에 쓸 이름과 소속 로컬을 먼저 등록하세요.');
  }
  return prisma.$transaction((tx) => acceptInside(tx, userId, token));
}

async function acceptInside(tx: Prisma.TransactionClient, userId: string, token: string) {
  const invite = await tx.gatheringInvite.findUnique({ where: { tokenHash: sha256(token) } });
  assertInviteUsable(invite);
  await rejectDuplicateJoin(tx, invite.groupId, userId);
  await consumeInvite(tx, invite);
  const status = invite.requiresApproval ? 'PENDING' : 'ACTIVE';
  const membership = await upsertMembership(tx, invite.groupId, userId, status);
  if (status === 'ACTIVE') {
    await ensureMemberRole(tx, invite.groupId, membership.id, userId);
  }
  await writeGatheringAudit(tx, {
    groupId: invite.groupId,
    actorUserId: userId,
    action: GatheringAuditAction.INVITE_ACCEPT,
    targetType: 'GatheringMembership',
    targetId: membership.id,
    meta: { status },
  });
  return { groupId: invite.groupId, status };
}

async function rejectDuplicateJoin(tx: Prisma.TransactionClient, groupId: string, userId: string) {
  const existing = await tx.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (existing && (existing.status === 'ACTIVE' || existing.status === 'PENDING')) {
    throw new AppError(409, 'ALREADY_MEMBER', '이미 참여 중이거나 승인 대기 중입니다.');
  }
  return existing;
}

async function consumeInvite(
  tx: Prisma.TransactionClient,
  invite: { id: string; maxUses: number | null },
) {
  const consumed = await tx.gatheringInvite.updateMany({
    where: {
      id: invite.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(invite.maxUses == null ? {} : { useCount: { lt: invite.maxUses } }),
    },
    data: { useCount: { increment: 1 } },
  });
  if (consumed.count !== 1) {
    throw new AppError(409, 'INVITE_EXHAUSTED', '초대 링크를 더 사용할 수 없습니다.');
  }
}

async function upsertMembership(
  tx: Prisma.TransactionClient,
  groupId: string,
  userId: string,
  status: 'PENDING' | 'ACTIVE',
) {
  const now = new Date();
  const data = {
    status,
    directoryConsentAt: now,
    joinedAt: status === 'ACTIVE' ? now : null,
    approvedAt: null,
    approvedByUserId: null,
  };
  return tx.gatheringMembership.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, ...data },
    update: data,
  });
}

async function ensureMemberRole(
  tx: Prisma.TransactionClient,
  groupId: string,
  membershipId: string,
  userId: string,
) {
  const existing = await tx.gatheringRoleAssignment.findFirst({
    where: { membershipId, role: 'MEMBER', revokedAt: null },
  });
  if (existing) return;
  await tx.gatheringRoleAssignment.create({
    data: { groupId, membershipId, userId, role: 'MEMBER', assignedByUserId: userId },
  });
}
