import type { Prisma, PrismaClient } from '@prisma/client';
import { evaluateEntitlement, type EntitlementDenial } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';

type Db = Prisma.TransactionClient | PrismaClient;

const MESSAGE: Record<EntitlementDenial, string> = {
  SUSPENDED: '모임이 정지되어 새 자료를 넣을 수 없습니다. 기존 자료는 볼 수 있습니다.',
  ENTITLEMENT_REQUIRED: '이용 기간이 끝나 새 자료를 넣을 수 없습니다. 기존 자료는 볼 수 있습니다.',
};

export async function gatheringWriteDecision(db: Db, groupId: string, now = new Date()) {
  const [group, covered] = await Promise.all([
    db.gatheringGroup.findUnique({ where: { id: groupId }, select: { suspendedAt: true } }),
    db.gatheringSubscription.findFirst({
      where: { groupId, status: 'ACTIVE', startsAt: { lte: now }, expiresAt: { gt: now } },
      select: { id: true },
    }),
  ]);
  return evaluateEntitlement({
    suspended: group?.suspendedAt != null,
    covered: covered != null,
    action: 'WRITE',
  });
}

export async function assertGatheringWritable(db: Db, groupId: string, now = new Date()) {
  const decision = await gatheringWriteDecision(db, groupId, now);
  if (!decision.allowed) {
    throw new AppError(409, decision.reason, MESSAGE[decision.reason]);
  }
}
