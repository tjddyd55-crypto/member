import type { GatheringInvite, Prisma } from '@prisma/client';
import type { GatheringInviteCreated } from '@member/contracts';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { DEFAULT_INVITE_HOURS, GatheringAuditAction } from './constants.js';
import { inviteLink, randomToken, sha256 } from './crypto.js';
import { toInviteView } from './presenters/group.js';

type InviteInput = {
  expiresInHours?: number;
  requiresApproval?: boolean;
  maxUses?: number | null;
  revokeInviteId?: string;
};

export async function createGatheringInvite(
  actorId: string,
  groupId: string,
  input: InviteInput,
): Promise<GatheringInviteCreated> {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'INVITE_MANAGE');
  const group = await prisma.gatheringGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  const token = randomToken(32);
  const invite = await prisma.$transaction((tx) =>
    insertInvite(tx, {
      actorId,
      groupId,
      token,
      input,
      fallbackApproval: group.inviteRequiresApproval,
    }),
  );
  return { invite: toInviteView(invite), token, link: inviteLink(token) };
}

async function insertInvite(
  tx: Prisma.TransactionClient,
  args: {
    actorId: string;
    groupId: string;
    token: string;
    input: InviteInput;
    fallbackApproval: boolean;
  },
) {
  if (args.input.revokeInviteId)
    await revokeInside(tx, args.groupId, args.input.revokeInviteId, args.actorId);
  const hours = args.input.expiresInHours ?? DEFAULT_INVITE_HOURS;
  const invite = await tx.gatheringInvite.create({
    data: {
      groupId: args.groupId,
      tokenHash: sha256(args.token),
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      requiresApproval: args.input.requiresApproval ?? args.fallbackApproval,
      maxUses: args.input.maxUses ?? null,
      createdByUserId: args.actorId,
    },
  });
  await writeGatheringAudit(tx, {
    groupId: args.groupId,
    actorUserId: args.actorId,
    action: GatheringAuditAction.INVITE_CREATE,
    targetType: 'GatheringInvite',
    targetId: invite.id,
  });
  return invite;
}

async function revokeInside(
  tx: Prisma.TransactionClient,
  groupId: string,
  inviteId: string,
  actorId: string,
) {
  const revoked = await tx.gatheringInvite.updateMany({
    where: { id: inviteId, groupId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) {
    throw new AppError(404, 'INVITE_NOT_FOUND', '폐기할 초대 링크를 찾을 수 없습니다.');
  }
  await writeGatheringAudit(tx, {
    groupId,
    actorUserId: actorId,
    action: GatheringAuditAction.INVITE_REVOKE,
    targetType: 'GatheringInvite',
    targetId: inviteId,
  });
}

export async function listGatheringInvites(actorId: string, groupId: string) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'INVITE_MANAGE');
  const invites = await prisma.gatheringInvite.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
  });
  return invites.map(toInviteView);
}

export async function revokeGatheringInvite(actorId: string, groupId: string, inviteId: string) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'INVITE_MANAGE');
  await prisma.$transaction((tx) => revokeInside(tx, groupId, inviteId, actorId));
  return { ok: true as const };
}

export async function previewGatheringInvite(token: string) {
  const invite = await loadUsableInvite(token);
  const group = await prisma.gatheringGroup.findUnique({ where: { id: invite.groupId } });
  if (!group) throw new AppError(400, 'INVITE_INVALID', '초대 링크가 유효하지 않습니다.');
  return {
    groupName: group.name,
    requiresApproval: invite.requiresApproval,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

export async function loadUsableInvite(token: string) {
  const invite = await prisma.gatheringInvite.findUnique({ where: { tokenHash: sha256(token) } });
  assertInviteUsable(invite);
  return invite;
}

export function assertInviteUsable(
  invite: GatheringInvite | null,
): asserts invite is GatheringInvite {
  if (!invite) throw new AppError(400, 'INVITE_INVALID', '초대 링크가 유효하지 않습니다.');
  if (invite.revokedAt) throw new AppError(400, 'INVITE_REVOKED', '폐기된 초대 링크입니다.');
  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new AppError(400, 'INVITE_EXPIRED', '만료된 초대 링크입니다.');
  }
  if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    throw new AppError(400, 'INVITE_EXHAUSTED', '초대 인원을 모두 사용했습니다.');
  }
}
