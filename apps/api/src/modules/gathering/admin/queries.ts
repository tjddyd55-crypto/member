import { STORAGE_QUOTA_BYTES, type AdminCapability } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { loadBillableUsage } from '../storage/usage.js';
import { writeAdminAudit } from './audit.js';

const contactInclude = {
  gatheringProfile: true,
  gatheringAffiliations: { where: { isCurrent: true }, take: 1 },
} as const;

export async function listAdminGroups(adminId: string) {
  const allowed = await readableGroupIds(adminId, 'GROUP_READ');
  if (allowed.ids && allowed.ids.length === 0) return [];
  const groups = await prisma.gatheringGroup.findMany({
    where: allowed.ids ? { id: { in: allowed.ids } } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  const rows = (await Promise.all(groups.map((group) => presentGroup(group.id)))).filter((row) => row != null);
  await writeAdminAudit(prisma, {
    actorAdminId: adminId,
    action: 'ADMIN_GROUP_LIST',
    after: { count: rows.length },
  });
  return rows;
}

export async function readAdminGroup(adminId: string, groupId: string) {
  const allowed = await readableGroupIds(adminId, 'GROUP_READ');
  if (allowed.ids && !allowed.ids.includes(groupId)) {
    throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
  const row = await presentGroup(groupId);
  if (!row) throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  await writeAdminAudit(prisma, {
    actorAdminId: adminId,
    action: 'ADMIN_GROUP_READ',
    targetType: 'GatheringGroup',
    targetId: groupId,
  });
  return row;
}

export async function listAdminAudits(adminId: string) {
  const account = await loadAccount(adminId);
  if (account.role !== 'SUPER_ADMIN' && !account.scopes.some((scope) => scope.capability === 'AUDIT_READ')) {
    throw new AppError(403, 'FORBIDDEN', '운영 이력을 볼 권한이 없습니다.');
  }
  const groupIds =
    account.role === 'SUPER_ADMIN'
      ? null
      : account.scopes.filter((scope) => scope.capability === 'AUDIT_READ').map((scope) => scope.groupId);
  const rows = await prisma.gatheringAdminAudit.findMany({
    where: groupIds ? { targetId: { in: groupIds } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { id: true, loginId: true, role: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor ? { id: row.actor.id, loginId: row.actor.loginId, role: row.actor.role } : null,
    targetType: row.targetType,
    targetId: row.targetId,
    before: parseJson(row.beforeJson),
    after: parseJson(row.afterJson),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function presentGroup(groupId: string) {
  const now = new Date();
  const group = await prisma.gatheringGroup.findUnique({
    where: { id: groupId },
    include: { createdBy: { include: contactInclude } },
  });
  if (!group) return null;
  const [president, memberCount, subscription, usage, latestAudit] = await Promise.all([
    prisma.gatheringRoleAssignment.findFirst({
      where: { groupId, role: 'PRESIDENT', revokedAt: null },
      include: { user: { include: contactInclude } },
      orderBy: { assignedAt: 'desc' },
    }),
    prisma.gatheringMembership.count({ where: { groupId, status: 'ACTIVE' } }),
    prisma.gatheringSubscription.findFirst({ where: { groupId }, orderBy: { createdAt: 'desc' } }),
    loadBillableUsage(prisma, groupId, now),
    prisma.gatheringAuditLog.findFirst({ where: { groupId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const covered = Boolean(
    subscription &&
      subscription.status === 'ACTIVE' &&
      subscription.startsAt &&
      subscription.expiresAt &&
      subscription.startsAt <= now &&
      subscription.expiresAt > now,
  );
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
    creator: contact(group.createdBy, group.createdAt),
    president: president ? contact(president.user, president.assignedAt) : null,
    memberCount,
    suspended: group.suspendedAt != null,
    subscription: {
      status: !subscription ? 'NONE' : covered ? 'ACTIVE' : 'EXPIRED',
      source: subscription?.source ?? null,
      startsAt: subscription?.startsAt?.toISOString() ?? null,
      expiresAt: subscription?.expiresAt?.toISOString() ?? null,
    },
    usedBytes: usage.mediaBytes + usage.receiptBytes + usage.otherBytes,
    quotaBytes: subscription ? Number(subscription.storageQuotaBytes) : STORAGE_QUOTA_BYTES,
    lastActivityAt: later(group.updatedAt, latestAudit?.createdAt ?? null).toISOString(),
  };
}

function contact(
  user: {
    id: string;
    phone: string | null;
    gatheringProfile: { displayName: string } | null;
    gatheringAffiliations: { localJcName: string }[];
  },
  since: Date,
) {
  return {
    id: user.id,
    name: user.gatheringProfile?.displayName ?? null,
    phone: user.phone,
    localJcName: user.gatheringAffiliations[0]?.localJcName ?? null,
    since: since.toISOString(),
  };
}

async function readableGroupIds(adminId: string, capability: AdminCapability) {
  const account = await loadAccount(adminId);
  if (account.role === 'SUPER_ADMIN') return { ids: null as string[] | null };
  return {
    ids: account.scopes.filter((scope) => scope.capability === capability).map((scope) => scope.groupId),
  };
}

async function loadAccount(adminId: string) {
  const account = await prisma.gatheringAdminAccount.findUnique({
    where: { id: adminId },
    include: { scopes: true },
  });
  if (!account || account.disabledAt) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  return account;
}

function later(left: Date, right: Date | null) {
  if (!right || left.getTime() >= right.getTime()) return left;
  return right;
}

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
