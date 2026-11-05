import type { Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { lockFinanceYear, lockGroup } from '../locks.js';

export async function readFiscalPeriod(tx: Prisma.TransactionClient, groupId: string): Promise<FiscalPeriod> {
  const group = await tx.gatheringGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { fiscalStartMonth: true, fiscalStartDay: true },
  });
  return { startMonth: group.fiscalStartMonth, startDay: group.fiscalStartDay };
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
