import type { GatheringHandover, Prisma } from '@prisma/client';
import { applyHandover, type HandoverAck } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { lockFinanceYear, lockGroup } from '../locks.js';
import { notifyGatheringUser } from '../push/service.js';
import { closeFinanceYear } from './close.js';
import { countPendingReceipts, loadHandoverFacts } from './facts.js';
import { sha256Canonical } from './hash.js';

export async function readHandover(userId: string, groupId: string) {
  const access = await requireGroupMember(userId, groupId, 'read');
  const year = await openYear(groupId);
  const handover = year
    ? await prisma.gatheringHandover.findFirst({
        where: { groupId, financeYearId: year.id, status: { not: 'CANCELLED' } },
      })
    : null;
  const ack = year ? (await loadHandoverFacts(prisma, year)).ack : null;
  return {
    year: year ? { year: year.year, status: year.status } : null,
    handover: handover ? presentHandover(handover) : null,
    preview: ack,
    actions: {
      nominate:
        !access.restricted && access.permissions.includes('HANDOVER') && year?.status === 'OPEN' && !handover,
      accept: !access.restricted && handover?.status === 'NOMINATED' && handover.toUserId === userId,
      confirm: !access.restricted && handover?.status === 'ACCEPTED' && handover.fromUserId === userId,
      finalize: !access.restricted && handover?.status === 'CONFIRMED' && handover.fromUserId === userId,
      cancel:
        !access.restricted &&
        access.permissions.includes('HANDOVER') &&
        handover != null &&
        handover.status !== 'FINALIZED' &&
        handover.fromUserId === userId,
    },
  };
}

export async function nominateHandover(
  actorId: string,
  groupId: string,
  input: { toUserId: string; idempotencyKey: string },
) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'HANDOVER');
  if (input.toUserId === actorId) throw new AppError(409, 'SUCCESSOR_INVALID', '본인을 차기 회장으로 지명할 수 없습니다.');
  const target = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId: input.toUserId } },
  });
  if (!target || target.status !== 'ACTIVE') {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
  }
  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockGroup(tx, groupId);
      const replay = await tx.gatheringHandover.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) {
        if (replay.groupId !== groupId) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', '같은 키를 다른 모임에 쓸 수 없습니다.');
        if (replay.status === 'CANCELLED' || replay.status === 'FINALIZED') {
          throw new AppError(409, 'IDEMPOTENCY_USED', '끝난 인계입니다. 새 키로 다시 지명하세요.');
        }
        return replay;
      }
      const year = await requireOpenYear(tx, groupId);
      return tx.gatheringHandover.create({
        data: {
          groupId,
          financeYearId: year.id,
          fromUserId: actorId,
          toUserId: input.toUserId,
          status: 'NOMINATED',
          idempotencyKey: input.idempotencyKey,
        },
      });
    });
    await writeGatheringAudit(prisma, {
      groupId,
      actorUserId: actorId,
      action: 'GATHERING_HANDOVER_NOMINATE',
      targetType: 'GatheringHandover',
      targetId: created.id,
    });
    await notifyGatheringUser({
      userId: created.toUserId,
      groupId,
      type: 'HANDOVER_NOMINATED',
      title: 'JCI KOREA',
      body: '차기 회장으로 지명되었습니다. 인계 화면에서 수락하세요.',
      dedupeKey: `HANDOVER_NOMINATED:${created.id}`,
    });
    return presentHandover(created);
  } catch (error) {
    if (isUnique(error)) throw new AppError(409, 'HANDOVER_EXISTS', '진행 중인 인계가 있습니다.');
    throw error;
  }
}

export async function acceptHandover(actorId: string, groupId: string, handoverId: string) {
  return moveHandover(actorId, groupId, handoverId, 'ACCEPT');
}

export async function confirmHandover(actorId: string, groupId: string, handoverId: string, ack: HandoverAck) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'HANDOVER');
  const saved = await prisma.$transaction(async (tx) => {
    const handover = await lockHandover(tx, actorId, groupId, handoverId);
    if (applyHandover(handover.status, 'CONFIRM') !== 'CONFIRMED') {
      throw new AppError(409, 'HANDOVER_STATE', '확인은 차기 회장이 수락한 뒤에만 할 수 있습니다.');
    }
    await assertNoPendingReceipts(tx, handover.financeYearId);
    const facts = await loadHandoverFacts(tx, handover.financeYear);
    if (!sameAck(facts.ack, ack)) {
      throw new AppError(409, 'CONFIRM_MISMATCH', '확인한 합계가 현재 장부와 다릅니다.');
    }
    await tx.gatheringHandover.update({
      where: { id: handover.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmHash: sha256Canonical(facts.fingerprint) },
    });
    return handover.id;
  });
  return { id: saved, status: 'CONFIRMED' as const };
}

export async function cancelHandover(actorId: string, groupId: string, handoverId: string) {
  return moveHandover(actorId, groupId, handoverId, 'CANCEL');
}

export async function finalizeHandover(actorId: string, groupId: string, handoverId: string) {
  const access = await requireGroupMember(actorId, groupId);
  const outcome = await prisma.$transaction(async (tx) => {
    const handover = await lockHandover(tx, actorId, groupId, handoverId);
    if (handover.status === 'FINALIZED') return { kind: 'replay' as const, body: await replay(tx, handover.financeYearId) };
    if (!access.permissions.includes('HANDOVER')) {
      throw new AppError(403, 'FORBIDDEN', '현 회장만 최종 인계를 승인할 수 있습니다.');
    }
    if (applyHandover(handover.status, 'FINALIZE') !== 'FINALIZED') {
      throw new AppError(409, 'HANDOVER_STATE', '최종 인계는 현 회장이 확인한 뒤에만 할 수 있습니다.');
    }
    if (handover.financeYear.status !== 'OPEN') {
      throw new AppError(409, 'FINANCE_YEAR_CLOSED', '마감된 회계연도는 다시 인계할 수 없습니다.');
    }
    await assertNoPendingReceipts(tx, handover.financeYearId);
    const facts = await loadHandoverFacts(tx, handover.financeYear);
    if (sha256Canonical(facts.fingerprint) !== handover.confirmHash) {
      await tx.gatheringHandover.update({
        where: { id: handover.id },
        data: { status: 'ACCEPTED', confirmedAt: null, confirmHash: null },
      });
      return { kind: 'stale' as const };
    }
    const closed = await closeFinanceYear(tx, handover, handover.financeYear, access.userId);
    return { kind: 'closed' as const, body: { ...closed, idempotent: false } };
  });
  if (outcome.kind === 'stale') {
    throw new AppError(409, 'HANDOVER_STALE', '확인 뒤 장부가 바뀌었습니다. 다시 확인하세요.');
  }
  return outcome.body;
}

async function moveHandover(
  actorId: string,
  groupId: string,
  handoverId: string,
  action: 'ACCEPT' | 'CANCEL',
) {
  const saved = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const handover = await tx.gatheringHandover.findFirst({ where: { id: handoverId, groupId } });
    if (!handover) throw new AppError(404, 'HANDOVER_NOT_FOUND', '인계를 찾을 수 없습니다.');
    if (action === 'ACCEPT' && handover.toUserId !== actorId) {
      throw new AppError(403, 'FORBIDDEN', '지명된 차기 회장만 수락할 수 있습니다.');
    }
    if (action === 'CANCEL' && handover.fromUserId !== actorId) {
      throw new AppError(403, 'FORBIDDEN', '현 회장만 인계를 취소할 수 있습니다.');
    }
    const next = applyHandover(handover.status, action);
    if (!next) throw new AppError(409, 'HANDOVER_STATE', '지금은 그 단계로 진행할 수 없습니다.');
    await tx.gatheringHandover.update({
      where: { id: handover.id },
      data: {
        status: next,
        acceptedAt: action === 'ACCEPT' ? new Date() : handover.acceptedAt,
      },
    });
    return { id: handover.id, status: next };
  });
  return saved;
}

async function lockHandover(tx: Prisma.TransactionClient, actorId: string, groupId: string, handoverId: string) {
  await lockGroup(tx, groupId);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM gathering_handovers WHERE id = ${handoverId} AND "groupId" = ${groupId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new AppError(404, 'HANDOVER_NOT_FOUND', '인계를 찾을 수 없습니다.');
  const handover = await tx.gatheringHandover.findUniqueOrThrow({
    where: { id: handoverId },
    include: { financeYear: true },
  });
  await lockFinanceYear(tx, handover.financeYearId);
  if (handover.fromUserId !== actorId) {
    throw new AppError(403, 'FORBIDDEN', '현 회장만 이 단계를 진행할 수 있습니다.');
  }
  return handover;
}

async function replay(tx: Prisma.TransactionClient, financeYearId: string) {
  const snapshot = await tx.gatheringFinanceCloseSnapshot.findUnique({ where: { financeYearId } });
  if (!snapshot) throw new AppError(409, 'HANDOVER_STATE', '마감 기록을 찾을 수 없습니다.');
  const payload = JSON.parse(snapshot.payloadJson) as { closingBalanceWon: number; fiscalYear: number };
  return {
    snapshotId: snapshot.id,
    contentHash: snapshot.contentHash,
    balanceWon: payload.closingBalanceWon,
    nextYear: payload.fiscalYear + 1,
    idempotent: true,
  };
}

async function openYear(groupId: string) {
  return prisma.gatheringFinanceYear.findFirst({
    where: { groupId, status: 'OPEN' },
    orderBy: { year: 'asc' },
  });
}

async function requireOpenYear(tx: Prisma.TransactionClient, groupId: string) {
  const year = await tx.gatheringFinanceYear.findFirst({
    where: { groupId, status: 'OPEN' },
    orderBy: { year: 'asc' },
  });
  if (!year) throw new AppError(409, 'FINANCE_YEAR_NOT_OPEN', '열린 회계연도가 없습니다.');
  await lockFinanceYear(tx, year.id);
  const current = await tx.gatheringFinanceYear.findUniqueOrThrow({ where: { id: year.id } });
  if (current.status !== 'OPEN') throw new AppError(409, 'FINANCE_YEAR_CLOSED', '마감된 회계연도입니다.');
  return current;
}

async function assertNoPendingReceipts(tx: Prisma.TransactionClient, financeYearId: string) {
  const pending = await countPendingReceipts(tx, financeYearId);
  if (pending > 0) throw new AppError(409, 'RECEIPTS_PENDING', '확인되지 않은 영수증이 있어 인계할 수 없습니다.');
}

function sameAck(current: HandoverAck, claimed: HandoverAck) {
  return (
    current.incomeWon === claimed.incomeWon &&
    current.expenseWon === claimed.expenseWon &&
    current.balanceWon === claimed.balanceWon &&
    current.dueCount === claimed.dueCount &&
    current.receiptCount === claimed.receiptCount
  );
}

function presentHandover(row: GatheringHandover) {
  return {
    id: row.id,
    status: row.status,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    financeYearId: row.financeYearId,
  };
}

function isUnique(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
