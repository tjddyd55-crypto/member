import type { Prisma } from '@prisma/client';
import { calendarYearKst } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { lockFinanceYear, lockGroup } from '../locks.js';

export function findYearContaining(tx: Prisma.TransactionClient, groupId: string, instant: Date) {
  return tx.gatheringFinanceYear.findFirst({
    where: { groupId, startsAt: { lte: instant }, endsAt: { gte: instant } },
    orderBy: { year: 'desc' },
  });
}

export async function lockOpenYearForInstant(tx: Prisma.TransactionClient, groupId: string, instant: Date) {
  await lockGroup(tx, groupId);
  const stored = await findYearContaining(tx, groupId, instant);
  if (stored) return lockOpenYearById(tx, groupId, stored.id);

  const calendarYear = calendarYearKst(instant);
  throw new AppError(409, 'FINANCE_YEAR_OUTSIDE_WINDOW',
    `해당 날짜를 포함하는 회계연도가 없습니다. ${calendarYear}년 회계 기간을 확인하세요.`);
}

export async function lockGroupOpenYear(tx: Prisma.TransactionClient, groupId: string, year: number) {
  await lockGroup(tx, groupId);
  const found = await tx.gatheringFinanceYear.findUnique({
    where: { groupId_year: { groupId, year } },
  });
  if (!found) {
    throw new AppError(409, 'FINANCE_YEAR_NOT_OPEN', '해당 회계연도가 열려 있지 않습니다.');
  }
  await lockFinanceYear(tx, found.id);
  const current = await tx.gatheringFinanceYear.findUniqueOrThrow({ where: { id: found.id } });
  if (current.status !== 'OPEN') {
    throw new AppError(409, 'FINANCE_YEAR_CLOSED', '마감된 회계연도는 수정할 수 없습니다.');
  }
  return current;
}

export async function lockOpenYearById(tx: Prisma.TransactionClient, groupId: string, financeYearId: string) {
  await lockGroup(tx, groupId);
  const found = await tx.gatheringFinanceYear.findFirst({ where: { id: financeYearId, groupId } });
  if (!found) throw new AppError(409, 'FINANCE_YEAR_NOT_OPEN', '해당 회계연도가 열려 있지 않습니다.');
  await lockFinanceYear(tx, found.id);
  const current = await tx.gatheringFinanceYear.findUniqueOrThrow({ where: { id: found.id } });
  if (current.status !== 'OPEN') {
    throw new AppError(409, 'FINANCE_YEAR_CLOSED', '마감된 회계연도는 수정할 수 없습니다.');
  }
  return current;
}
