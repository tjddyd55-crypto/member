import type { Prisma, PrismaClient } from '@prisma/client';

type AuditDb = Prisma.TransactionClient | PrismaClient;

export async function writeGatheringAudit(
  db: AuditDb,
  entry: {
    groupId?: string;
    actorUserId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, string | number | boolean | null>;
  },
) {
  await db.gatheringAuditLog.create({
    data: {
      groupId: entry.groupId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metaJson: entry.meta ? JSON.stringify(entry.meta) : null,
    },
  });
}
