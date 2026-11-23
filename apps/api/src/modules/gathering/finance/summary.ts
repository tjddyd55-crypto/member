import { summarizeFinance } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import { presentTransaction } from './transactions.js';

export async function financeSummary(userId: string, groupId: string, year?: number) {
  await requireGroupMember(userId, groupId, 'read');
  const financeYear = await selectYear(groupId, year);
  const [transactions, dues] = await Promise.all([
    prisma.gatheringFinanceTransaction.findMany({
      where: { financeYearId: financeYear.id },
      include: { event: { select: { id: true, title: true } } },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.gatheringMemberDue.findMany({
      where: { financeYearId: financeYear.id },
      include: { user: { select: { gatheringProfile: { select: { displayName: true } } } }, membership: { select: { manualDisplayName: true } } },
      orderBy: { userId: 'asc' },
    }),
  ]);
  const duesPaidWon = dues.reduce((sum, row) => sum + row.paidAmountWon, 0);
  const includeDues = await duesCountInBalance(financeYear.id, financeYear.status);
  const totals = summarizeFinance({
    openingBalanceWon: financeYear.openingBalanceWon,
    entries: transactions,
    duesPaidWon: includeDues ? duesPaidWon : 0,
  });
  if (!includeDues) totals.duesWon = duesPaidWon;
  const yearRows = await prisma.gatheringFinanceYear.findMany({
    where: { groupId },
    orderBy: { year: 'desc' },
    select: { year: true, status: true, startsAt: true, endsAt: true },
  });
  const years = yearRows.map((row) => ({
    year: row.year,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
  return {
    year: financeYear.year,
    status: financeYear.status,
    startsAt: financeYear.startsAt.toISOString(),
    endsAt: financeYear.endsAt.toISOString(),
    openingBalanceWon: financeYear.openingBalanceWon,
    ...totals,
    years,
    dues: dues.map((row) => ({
      id: row.id,
      userId: row.userId,
      membershipId: row.membershipId,
      displayName:
        row.userId === null
          ? (row.membership?.manualDisplayName ?? '회원')
          : (row.user?.gatheringProfile?.displayName ?? '회원'),
      amountWon: row.amountWon,
      paidAmountWon: row.paidAmountWon,
      paidAt: row.paidAt?.toISOString() ?? null,
      status: row.status,
    })),
    events: eventTotals(transactions),
    general: {
      incomeWon: totals.generalIncomeWon,
      expenseWon: totals.generalExpenseWon,
      netWon: totals.generalIncomeWon - totals.generalExpenseWon,
      items: transactions
        .filter((row) => row.eventId === null)
        .map((row) => ({
          ...presentTransaction(row, financeYear.year),
          locked: financeYear.status === 'CLOSED',
        })),
    },
  };
}

async function duesCountInBalance(financeYearId: string, status: string) {
  if (status !== 'CLOSED') return true;
  const snapshot = await prisma.gatheringFinanceCloseSnapshot.findUnique({ where: { financeYearId } });
  if (!snapshot) return false;
  const payload = JSON.parse(snapshot.payloadJson) as { duesInClosingBalance?: boolean };
  return payload.duesInClosingBalance === true;
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
    eventId: string | null;
    direction: 'INCOME' | 'EXPENSE';
    amountWon: number;
    event: { id: string; title: string } | null;
  }>,
) {
  const grouped = new Map<string, { eventId: string; title: string; incomeWon: number; expenseWon: number; netWon: number }>();
  for (const row of transactions) {
    if (row.eventId === null || row.event === null) continue;
    const current = grouped.get(row.eventId) ?? {
      eventId: row.eventId,
      title: row.event.title,
      incomeWon: 0,
      expenseWon: 0,
      netWon: 0,
    };
    if (row.direction === 'INCOME') current.incomeWon += row.amountWon;
    else current.expenseWon += row.amountWon;
    current.netWon = current.incomeWon - current.expenseWon;
    grouped.set(row.eventId, current);
  }
  return [...grouped.values()];
}
