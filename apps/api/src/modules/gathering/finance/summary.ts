import { summarizeLedger } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';

export async function financeSummary(userId: string, groupId: string, year?: number) {
  await requireGroupMember(userId, groupId);
  const financeYear = await selectYear(groupId, year);
  const [transactions, dues] = await Promise.all([
    prisma.gatheringFinanceTransaction.findMany({
      where: { financeYearId: financeYear.id },
      include: { event: { select: { id: true, title: true } } },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.gatheringMemberDue.findMany({
      where: { financeYearId: financeYear.id },
      include: { user: { select: { gatheringProfile: { select: { displayName: true } } } } },
      orderBy: { userId: 'asc' },
    }),
  ]);
  const totals = summarizeLedger(
    financeYear.openingBalanceWon,
    transactions.map((row) => ({ direction: row.direction, amountWon: row.amountWon })),
  );
  return {
    year: financeYear.year,
    status: financeYear.status,
    startsAt: financeYear.startsAt.toISOString(),
    endsAt: financeYear.endsAt.toISOString(),
    openingBalanceWon: financeYear.openingBalanceWon,
    ...totals,
    dues: dues.map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.user.gatheringProfile?.displayName ?? '회원',
      amountWon: row.amountWon,
      paidAmountWon: row.paidAmountWon,
      paidAt: row.paidAt?.toISOString() ?? null,
      status: row.status,
    })),
    events: eventTotals(transactions),
  };
}

async function selectYear(groupId: string, year?: number) {
  if (year != null) {
    const selected = await prisma.gatheringFinanceYear.findUnique({
      where: { groupId_year: { groupId, year } },
    });
    if (!selected) throw new AppError(404, 'FINANCE_YEAR_NOT_FOUND', '회계연도를 찾을 수 없습니다.');
    return selected;
  }
  const open = await prisma.gatheringFinanceYear.findFirst({
    where: { groupId, status: 'OPEN' },
    orderBy: { year: 'desc' },
  });
  if (!open) throw new AppError(404, 'FINANCE_YEAR_NOT_FOUND', '열린 회계연도가 없습니다.');
  return open;
}

function eventTotals(
  transactions: Array<{
    eventId: string;
    direction: 'INCOME' | 'EXPENSE';
    amountWon: number;
    event: { id: string; title: string };
  }>,
) {
  const grouped = new Map<string, { eventId: string; title: string; incomeWon: number; expenseWon: number }>();
  for (const row of transactions) {
    const current = grouped.get(row.eventId) ?? {
      eventId: row.eventId,
      title: row.event.title,
      incomeWon: 0,
      expenseWon: 0,
    };
    if (row.direction === 'INCOME') current.incomeWon += row.amountWon;
    else current.expenseWon += row.amountWon;
    grouped.set(row.eventId, current);
  }
  return [...grouped.values()];
}
