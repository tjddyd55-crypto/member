import type { GatheringEntryDirection, GatheringFinanceTransaction, Prisma } from '@prisma/client';
import { fiscalYearOf, parseWon } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { assertGatheringWritable } from '../entitlement.js';
import { lockGroup } from '../locks.js';
import { lockGroupOpenYear, readFiscalPeriod } from './years.js';

export type TransactionInput = {
  direction: GatheringEntryDirection;
  label: string;
  amountWon: number;
  paidAt: string;
  note?: string | null;
  adjustment?: boolean;
};

export async function createTransaction(userId: string, groupId: string, eventId: string, input: TransactionInput) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'FINANCE_WRITE');
  const parsed = parseTransaction(input);
  await requireEvent(groupId, eventId);
  const created = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    await assertGatheringWritable(tx, groupId);
    const period = await readFiscalPeriod(tx, groupId);
    const year = await lockGroupOpenYear(tx, groupId, fiscalYearOf(parsed.paidAt, period));
    const row = await tx.gatheringFinanceTransaction.create({
      data: {
        groupId,
        eventId,
        financeYearId: year.id,
        direction: parsed.direction,
        label: parsed.label,
        amountWon: parsed.amountWon,
        paidAt: parsed.paidAt,
        note: parsed.note,
        adjustment: parsed.adjustment,
        createdByUserId: userId,
      },
    });
    return { row, fiscalYear: year.year };
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.FINANCE_WRITE,
    targetType: 'GatheringFinanceTransaction',
    targetId: created.row.id,
  });
  return presentTransaction(created.row, created.fiscalYear);
}

export async function updateTransaction(
  userId: string,
  groupId: string,
  transactionId: string,
  input: TransactionInput,
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'FINANCE_WRITE');
  const parsed = parseTransaction(input);
  const updated = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    await assertGatheringWritable(tx, groupId);
    const period = await readFiscalPeriod(tx, groupId);
    const current = await requireMutable(tx, groupId, transactionId);
    assertYearOpen(current.financeYear.status);
    const year = await lockGroupOpenYear(tx, groupId, fiscalYearOf(parsed.paidAt, period));
    const row = await tx.gatheringFinanceTransaction.update({
      where: { id: current.id },
      data: {
        financeYearId: year.id,
        direction: parsed.direction,
        label: parsed.label,
        amountWon: parsed.amountWon,
        paidAt: parsed.paidAt,
        note: parsed.note,
        adjustment: parsed.adjustment,
      },
    });
    return { row, fiscalYear: year.year };
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.FINANCE_WRITE,
    targetType: 'GatheringFinanceTransaction',
    targetId: updated.row.id,
  });
  return presentTransaction(updated.row, updated.fiscalYear);
}

export async function deleteTransaction(userId: string, groupId: string, transactionId: string) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'FINANCE_WRITE');
  await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    await assertGatheringWritable(tx, groupId);
    const current = await requireMutable(tx, groupId, transactionId);
    assertYearOpen(current.financeYear.status);
    await lockGroupOpenYear(tx, groupId, current.financeYear.year);
    await tx.gatheringFinanceTransaction.delete({ where: { id: current.id } });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: access.userId,
      action: GatheringAuditAction.FINANCE_DELETE,
      targetType: 'GatheringFinanceTransaction',
      targetId: current.id,
    });
  });
  return { ok: true as const };
}

export async function listEventTransactions(userId: string, groupId: string, eventId: string) {
  await requireGroupMember(userId, groupId);
  await requireEvent(groupId, eventId);
  const rows = await prisma.gatheringFinanceTransaction.findMany({
    where: { groupId, eventId },
    include: { financeYear: { select: { year: true } } },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
  });
  return { items: rows.map((row) => presentTransaction(row, row.financeYear.year)) };
}

export function presentTransaction(row: GatheringFinanceTransaction, fiscalYear: number) {
  return {
    id: row.id,
    eventId: row.eventId,
    direction: row.direction,
    label: row.label,
    amountWon: row.amountWon,
    paidAt: row.paidAt.toISOString(),
    note: row.note,
    adjustment: row.adjustment,
    fiscalYear,
  };
}

function parseTransaction(input: TransactionInput) {
  const amount = parseWon(input.amountWon);
  if (!amount.ok) throw new AppError(400, 'INVALID_AMOUNT', amount.message);
  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) throw new AppError(400, 'INVALID_DATE', '결제일이 올바르지 않습니다.');
  const note = input.note?.trim() ? input.note.trim() : null;
  const adjustment = input.adjustment === true;
  if (adjustment && !note) {
    throw new AppError(400, 'ADJUSTMENT_NOTE_REQUIRED', '정정 거래에는 비고가 필요합니다.');
  }
  return {
    direction: input.direction,
    label: input.label.trim(),
    amountWon: amount.value,
    paidAt,
    note,
    adjustment,
  };
}

async function requireEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    select: { id: true, startsAt: true },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
  return event;
}

function assertYearOpen(status: string) {
  if (status !== 'OPEN') {
    throw new AppError(409, 'FINANCE_YEAR_CLOSED', '마감된 회계연도는 수정할 수 없습니다.');
  }
}

async function requireMutable(
  tx: Prisma.TransactionClient,
  groupId: string,
  transactionId: string,
) {
  const current = await tx.gatheringFinanceTransaction.findFirst({
    where: { id: transactionId, groupId },
    include: { financeYear: true },
  });
  if (!current) throw new AppError(404, 'TRANSACTION_NOT_FOUND', '장부 항목을 찾을 수 없습니다.');
  return current;
}
