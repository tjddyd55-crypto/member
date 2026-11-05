import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { queuedReportStatuses } from '../media/reports.js';
import { assertOperatorSecret } from '../subscription/service.js';

export async function blockedUserIds(groupId: string, blockerUserId: string) {
  const rows = await prisma.gatheringMemberBlock.findMany({
    where: { groupId, blockerUserId },
    select: { blockedUserId: true },
  });
  return new Set(rows.map((row) => row.blockedUserId));
}

export async function blockMember(actorId: string, groupId: string, blockedUserId: string) {
  await requireGroupMember(actorId, groupId);
  if (actorId === blockedUserId) throw new AppError(400, 'BLOCK_SELF', '본인을 차단할 수 없습니다.');
  const target = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId: blockedUserId } },
  });
  if (!target || target.status !== 'ACTIVE') {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
  }
  await prisma.gatheringMemberBlock.upsert({
    where: { groupId_blockerUserId_blockedUserId: { groupId, blockerUserId: actorId, blockedUserId } },
    create: { groupId, blockerUserId: actorId, blockedUserId },
    update: {},
  });
  return { ok: true as const };
}

export async function unblockMember(actorId: string, groupId: string, blockedUserId: string) {
  await requireGroupMember(actorId, groupId);
  await prisma.gatheringMemberBlock.deleteMany({
    where: { groupId, blockerUserId: actorId, blockedUserId },
  });
  return { ok: true as const };
}

export async function listOpenReports(actorId: string, header: string | string[] | undefined) {
  assertOperatorSecret(header);
  await requireOperatorUser(actorId);
  const items = await prisma.gatheringMediaReport.findMany({
    where: { status: { in: [...queuedReportStatuses] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      groupId: item.groupId,
      mediaAssetId: item.mediaAssetId,
      reason: item.reason,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

export async function resolveReportAsOperator(
  actorId: string,
  header: string | string[] | undefined,
  reportId: string,
  status: 'RESOLVED' | 'DISMISSED' | 'REVIEWING',
) {
  assertOperatorSecret(header);
  await requireOperatorUser(actorId);
  const updated = await prisma.gatheringMediaReport.updateMany({
    where: { id: reportId, status: { in: ['OPEN', 'REVIEWING'] } },
    data: { status, resolvedAt: status === 'REVIEWING' ? null : new Date() },
  });
  if (updated.count !== 1) throw new AppError(404, 'REPORT_NOT_FOUND', '신고를 찾을 수 없습니다.');
  return { ok: true as const, status };
}

export async function suspendMemberAsOperator(
  actorId: string,
  header: string | string[] | undefined,
  membershipId: string,
) {
  assertOperatorSecret(header);
  await requireOperatorUser(actorId);
  const membership = await prisma.gatheringMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new AppError(404, 'MEMBER_NOT_FOUND', '회원을 찾을 수 없습니다.');
  const president = await prisma.gatheringRoleAssignment.findFirst({
    where: { membershipId, role: 'PRESIDENT', revokedAt: null },
  });
  if (president) throw new AppError(403, 'PRESIDENT_LOCKED', '회장은 인계 뒤에만 이용을 막을 수 있습니다.');
  await prisma.gatheringMembership.update({
    where: { id: membershipId },
    data: { status: 'SUSPENDED' },
  });
  return { ok: true as const };
}

export async function assertNotBlocked(groupId: string, viewerId: string, otherUserId: string) {
  const block = await prisma.gatheringMemberBlock.findUnique({
    where: {
      groupId_blockerUserId_blockedUserId: {
        groupId,
        blockerUserId: viewerId,
        blockedUserId: otherUserId,
      },
    },
  });
  if (block) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
}

async function requireOperatorUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
}

export async function moderateMembership(actorId: string, groupId: string, membershipId: string) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'MEMBER_MANAGE');
  return suspendInsideGroup(access.userId, groupId, membershipId);
}

async function suspendInsideGroup(actorId: string, groupId: string, membershipId: string) {
  const membership = await prisma.gatheringMembership.findFirst({ where: { id: membershipId, groupId } });
  if (!membership) throw new AppError(404, 'MEMBER_NOT_FOUND', '회원을 찾을 수 없습니다.');
  if (membership.userId === actorId) throw new AppError(400, 'BLOCK_SELF', '본인 이용을 막을 수 없습니다.');
  const president = await prisma.gatheringRoleAssignment.findFirst({
    where: { membershipId, role: 'PRESIDENT', revokedAt: null },
  });
  if (president) throw new AppError(403, 'PRESIDENT_LOCKED', '회장은 인계 뒤에만 이용을 막을 수 있습니다.');
  await prisma.gatheringMembership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED' } });
  return { ok: true as const };
}
