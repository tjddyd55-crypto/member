import { timingSafeEqual } from 'node:crypto';
import {
  STORAGE_QUOTA_BYTES,
  billableStorageBytes,
  formalTermExpiry,
  subscriptionNoticeDedupeKey,
  subscriptionNoticeWindow,
} from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { lockGroup } from '../locks.js';
import { gatheringWriteDecision } from '../entitlement.js';
import { isSubscriptionActive, loadBillableUsage } from '../storage/usage.js';

const TEST_OPERATOR_SECRET = 'test-operator-secret-not-for-prod';

export type GrantInput = {
  source: 'PAID' | 'COMPLIMENTARY';
  idempotencyKey: string;
  note?: string;
  startsAt?: string;
};

export function currentOperatorSecret() {
  if (process.env.GATHERING_OPERATOR_SECRET) return process.env.GATHERING_OPERATOR_SECRET;
  if (process.env.NODE_ENV === 'test') return TEST_OPERATOR_SECRET;
  return '';
}

export function assertOperatorSecret(header: string | string[] | undefined) {
  const expected = currentOperatorSecret();
  const provided = Array.isArray(header) ? header[0] : header;
  if (!expected || !provided || !safeEqual(provided, expected)) {
    throw new AppError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다.');
  }
}

export async function grantSubscription(actorUserId: string, groupId: string, input: GrantInput) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true } });
  if (!actor) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  const group = await prisma.gatheringGroup.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  if (Number.isNaN(startsAt.getTime())) throw new AppError(400, 'INVALID_DATE', '시작 시각이 올바르지 않습니다.');
  const saved = await prisma.$transaction((tx) => saveGrant(tx, actorUserId, groupId, input, startsAt));
  return presentGrant(saved);
}

export async function readSubscription(userId: string, groupId: string) {
  await requireGroupMember(userId, groupId);
  const now = new Date();
  const [latest, usage, active] = await Promise.all([
    prisma.gatheringSubscription.findFirst({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
    }),
    loadBillableUsage(prisma, groupId, now),
    isSubscriptionActive(prisma, groupId, now),
  ]);
  const expiredByDate = latest?.expiresAt != null && latest.expiresAt.getTime() <= now.getTime();
  const status = !latest ? 'NONE' : active ? 'ACTIVE' : expiredByDate || latest.status !== 'ACTIVE' ? 'EXPIRED' : latest.status;
  const writes = await gatheringWriteDecision(prisma, groupId, now);
  return {
    status,
    source: latest?.source ?? null,
    startsAt: latest?.startsAt?.toISOString() ?? null,
    expiresAt: latest?.expiresAt?.toISOString() ?? null,
    quotaBytes: latest ? Number(latest.storageQuotaBytes) : STORAGE_QUOTA_BYTES,
    usedBytes: billableStorageBytes(usage),
    suspended: !writes.allowed && writes.reason === 'SUSPENDED',
    uploadsAllowed: writes.allowed,
  };
}

export async function dispatchSubscriptionNotices(now = new Date()) {
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.gatheringSubscription.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: horizon } },
  });
  let created = 0;
  for (const row of rows) {
    if (!row.expiresAt) continue;
    const window = subscriptionNoticeWindow(row.expiresAt, now);
    if (window) created += await notifyPresidents(row.groupId, row.expiresAt, window);
    if (row.expiresAt.getTime() <= now.getTime()) {
      await prisma.gatheringSubscription.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
    }
  }
  return { created };
}

async function saveGrant(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  actorUserId: string,
  groupId: string,
  input: GrantInput,
  startsAt: Date,
) {
  await lockGroup(tx, groupId);
  const replay = await tx.gatheringSubscription.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.groupId !== groupId) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '같은 키를 다른 모임에 쓸 수 없습니다.');
    }
    return replay;
  }
  const now = new Date();
  const previous = await tx.gatheringSubscription.findFirst({
    where: { groupId, status: 'ACTIVE' },
    orderBy: { startsAt: 'desc' },
  });
  const currentStillCovers = Boolean(
    previous?.startsAt && previous.expiresAt && previous.startsAt <= now && previous.expiresAt > now,
  );
  if (previous && !(startsAt > now && currentStillCovers)) {
    await tx.gatheringSubscription.update({ where: { id: previous.id }, data: { status: 'EXPIRED' } });
  }
  const created = await tx.gatheringSubscription.create({
    data: {
      groupId,
      status: 'ACTIVE',
      source: input.source,
      approvedByUserId: actorUserId,
      approvedAt: startsAt,
      startsAt,
      expiresAt: formalTermExpiry(startsAt, currentStillCovers ? previous?.expiresAt ?? null : null, now),
      storageQuotaBytes: BigInt(STORAGE_QUOTA_BYTES),
      note: input.note ?? null,
      idempotencyKey: input.idempotencyKey,
    },
  });
  await tx.gatheringSubscriptionAudit.create({
    data: {
      groupId,
      subscriptionId: created.id,
      action: previous ? 'RENEW' : 'GRANT',
      actorUserId,
      metaJson: JSON.stringify({ source: input.source, previousId: previous?.id ?? null }),
    },
  });
  await writeGatheringAudit(tx, {
    groupId,
    actorUserId,
    action: previous ? 'GATHERING_SUBSCRIPTION_RENEW' : 'GATHERING_SUBSCRIPTION_GRANT',
    targetType: 'GatheringSubscription',
    targetId: created.id,
    meta: { source: input.source },
  });
  return created;
}

async function notifyPresidents(groupId: string, expiresAt: Date, window: 'DAYS_30' | 'DAYS_7' | 'DAY_0') {
  const presidents = await prisma.gatheringRoleAssignment.findMany({
    where: { groupId, role: 'PRESIDENT', revokedAt: null },
    select: { userId: true },
  });
  let created = 0;
  for (const president of presidents) {
    const dedupeKey = subscriptionNoticeDedupeKey({ groupId, userId: president.userId, expiresAt, window });
    try {
      await prisma.gatheringNotification.create({
        data: {
          userId: president.userId,
          groupId,
          type: 'SUBSCRIPTION_EXPIRING',
          payloadJson: JSON.stringify({ window, expiresAt: expiresAt.toISOString() }),
          status: 'SKIPPED',
          dedupeKey,
        },
      });
      created += 1;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
  }
  return created;
}

function presentGrant(row: {
  id: string;
  status: string;
  source: string;
  startsAt: Date | null;
  expiresAt: Date | null;
}) {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    startsAt: row.startsAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function safeEqual(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
