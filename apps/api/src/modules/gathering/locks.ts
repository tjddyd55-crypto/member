import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';

export async function lockGroup(tx: Prisma.TransactionClient, groupId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM gathering_groups WHERE id = ${groupId} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
}

export async function lockFinanceYear(tx: Prisma.TransactionClient, financeYearId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM gathering_finance_years WHERE id = ${financeYearId} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new AppError(404, 'FINANCE_YEAR_NOT_FOUND', '회계연도를 찾을 수 없습니다.');
  }
}
