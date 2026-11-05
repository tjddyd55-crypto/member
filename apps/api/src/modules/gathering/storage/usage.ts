import type { Prisma, PrismaClient } from '@prisma/client';
import { UPLOAD_INTENT_TTL_MS, type StorageUsage } from '@member/gathering-domain';

type UsageDb = Prisma.TransactionClient | PrismaClient;

export async function loadBillableUsage(db: UsageDb, groupId: string, now: Date): Promise<StorageUsage> {
  const pendingSince = new Date(now.getTime() - UPLOAD_INTENT_TTL_MS);
  const [media, receipts] = await Promise.all([
    sumBytes(db, 'media', groupId, pendingSince),
    sumBytes(db, 'receipt', groupId, pendingSince),
  ]);
  return { mediaBytes: media, receiptBytes: receipts, otherBytes: 0 };
}

export async function isSubscriptionActive(db: UsageDb, groupId: string, now: Date) {
  const row = await db.gatheringSubscription.findFirst({
    where: {
      groupId,
      status: 'ACTIVE',
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return row !== null;
}

async function sumBytes(db: UsageDb, kind: 'media' | 'receipt', groupId: string, pendingSince: Date) {
  const where = {
    groupId,
    deletedAt: null,
    OR: [{ status: 'READY' as const }, { status: 'PENDING' as const, createdAt: { gte: pendingSince } }],
  };
  const aggregate =
    kind === 'media'
      ? await db.gatheringMediaAsset.aggregate({ where, _sum: { sizeBytes: true } })
      : await db.gatheringReceiptAsset.aggregate({ where, _sum: { sizeBytes: true } });
  return Number(aggregate._sum.sizeBytes ?? 0n);
}
