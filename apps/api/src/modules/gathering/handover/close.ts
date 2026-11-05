import type { GatheringFinanceYear, GatheringHandover, Prisma } from '@prisma/client';
import { fiscalYearRange } from '@member/gathering-domain';
import { readFiscalPeriod } from '../finance/years.js';
import { AppError } from '../../../lib/errors.js';
import { writeGatheringAudit } from '../audit.js';
import { loadHandoverFacts } from './facts.js';
import { sha256Canonical } from './hash.js';

type CloseTx = Prisma.TransactionClient;

export async function closeFinanceYear(
  tx: CloseTx,
  handover: GatheringHandover,
  financeYear: GatheringFinanceYear,
  actorId: string,
) {
  const now = new Date();
  await endCurrentOfficers(tx, handover.groupId, actorId, now);
  await ensureMemberRole(tx, handover.groupId, handover.fromUserId, actorId);
  await installSuccessor(tx, handover, financeYear.year + 1, actorId, now);
  const nextYear = financeYear.year + 1;
  const existing = await tx.gatheringFinanceYear.findUnique({
    where: { groupId_year: { groupId: handover.groupId, year: nextYear } },
  });
  if (existing) throw new AppError(409, 'NEXT_YEAR_EXISTS', '다음 회계연도가 이미 있습니다.');
  const facts = await loadHandoverFacts(tx, financeYear);
  const range = fiscalYearRange(nextYear, await readFiscalPeriod(tx, handover.groupId));
  await tx.gatheringFinanceYear.create({
    data: {
      groupId: handover.groupId,
      year: nextYear,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      status: 'OPEN',
      openingBalanceWon: facts.ack.balanceWon,
    },
  });
  await tx.gatheringFinanceYear.update({
    where: { id: financeYear.id },
    data: { status: 'CLOSED', closedAt: now },
  });
  await tx.gatheringReceiptAsset.updateMany({
    where: { financeYearId: financeYear.id, deletedAt: null },
    data: { immutable: true },
  });
  const closedFacts = await loadHandoverFacts(tx, financeYear);
  const payload = snapshotPayload(handover, financeYear, closedFacts, actorId);
  const contentHash = sha256Canonical(payload);
  const snapshot = await tx.gatheringFinanceCloseSnapshot.create({
    data: {
      groupId: handover.groupId,
      financeYearId: financeYear.id,
      payloadJson: JSON.stringify(payload),
      contentHash,
      closedByUserId: actorId,
    },
  });
  const finalized = await tx.gatheringHandover.updateMany({
    where: { id: handover.id, status: 'CONFIRMED' },
    data: { status: 'FINALIZED', finalizedAt: now },
  });
  if (finalized.count !== 1) throw new AppError(409, 'HANDOVER_STATE', '인계 상태가 바뀌었습니다.');
  await writeGatheringAudit(tx, {
    groupId: handover.groupId,
    actorUserId: actorId,
    action: 'GATHERING_HANDOVER_FINALIZE',
    targetType: 'GatheringFinanceCloseSnapshot',
    targetId: snapshot.id,
    meta: { year: financeYear.year, balanceWon: facts.ack.balanceWon },
  });
  return { snapshotId: snapshot.id, contentHash, balanceWon: facts.ack.balanceWon, nextYear };
}

async function endCurrentOfficers(tx: CloseTx, groupId: string, actorId: string, now: Date) {
  await tx.gatheringRoleAssignment.updateMany({
    where: {
      groupId,
      revokedAt: null,
      role: { in: ['PRESIDENT', 'SECRETARY', 'TREASURER', 'EXECUTIVE'] },
    },
    data: { revokedAt: now, revokedByUserId: actorId },
  });
  await tx.gatheringExecutiveTerm.updateMany({
    where: {
      groupId,
      endedAt: null,
      role: { in: ['PRESIDENT', 'SECRETARY', 'TREASURER', 'EXECUTIVE'] },
    },
    data: { endedAt: now },
  });
}

async function ensureMemberRole(tx: CloseTx, groupId: string, userId: string, actorId: string) {
  const membership = await tx.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership || membership.status !== 'ACTIVE') return;
  const existing = await tx.gatheringRoleAssignment.findFirst({
    where: { membershipId: membership.id, role: 'MEMBER', revokedAt: null },
  });
  if (existing) return;
  await tx.gatheringRoleAssignment.create({
    data: {
      groupId,
      membershipId: membership.id,
      userId,
      role: 'MEMBER',
      assignedByUserId: actorId,
    },
  });
}

async function installSuccessor(
  tx: CloseTx,
  handover: GatheringHandover,
  nextYear: number,
  actorId: string,
  now: Date,
) {
  const membership = await tx.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId: handover.groupId, userId: handover.toUserId } },
  });
  if (!membership || membership.status !== 'ACTIVE') {
    throw new AppError(409, 'SUCCESSOR_UNAVAILABLE', '차기 회장이 활동 회원이 아닙니다.');
  }
  await tx.gatheringRoleAssignment.create({
    data: {
      groupId: handover.groupId,
      membershipId: membership.id,
      userId: handover.toUserId,
      role: 'PRESIDENT',
      assignedByUserId: actorId,
    },
  });
  await tx.gatheringExecutiveTerm.create({
    data: {
      groupId: handover.groupId,
      userId: handover.toUserId,
      role: 'PRESIDENT',
      fiscalYear: nextYear,
      startedAt: now,
    },
  });
}

function snapshotPayload(
  handover: GatheringHandover,
  financeYear: GatheringFinanceYear,
  facts: Awaited<ReturnType<typeof loadHandoverFacts>>,
  actorId: string,
) {
  return {
    version: 1,
    groupId: handover.groupId,
    fiscalYear: financeYear.year,
    startsAt: financeYear.startsAt.toISOString(),
    endsAt: financeYear.endsAt.toISOString(),
    openingBalanceWon: financeYear.openingBalanceWon,
    incomeWon: facts.ack.incomeWon,
    expenseWon: facts.ack.expenseWon,
    closingBalanceWon: facts.ack.balanceWon,
    transactions: facts.transactions.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      direction: row.direction,
      label: row.label,
      amountWon: row.amountWon,
      paidAt: row.paidAt.toISOString(),
      note: row.note,
      adjustment: row.adjustment,
    })),
    dues: facts.dues.map((row) => ({
      id: row.id,
      userId: row.userId,
      amountWon: row.amountWon,
      paidAmountWon: row.paidAmountWon,
      paidAt: row.paidAt?.toISOString() ?? null,
      status: row.status,
    })),
    receipts: facts.receipts.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      storageKey: row.storageKey,
      checksum: row.checksum,
      version: row.version,
      sizeBytes: row.sizeBytes.toString(),
      mimeType: row.mimeType,
    })),
    officers: facts.officers.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      title: row.title,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
    })),
    successorUserId: handover.toUserId,
    closedByUserId: actorId,
  };
}
