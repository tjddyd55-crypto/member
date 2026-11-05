import type { Prisma, PrismaClient } from '@prisma/client';
import { handoverAck, summarizeLedger } from '@member/gathering-domain';

type FactDb = Prisma.TransactionClient | PrismaClient;

export async function loadHandoverFacts(
  db: FactDb,
  financeYear: { id: string; groupId: string; year: number; openingBalanceWon: number },
) {
  const [transactions, dues, receipts, officers] = await Promise.all([
    db.gatheringFinanceTransaction.findMany({ where: { financeYearId: financeYear.id }, orderBy: { id: 'asc' } }),
    db.gatheringMemberDue.findMany({ where: { financeYearId: financeYear.id }, orderBy: { id: 'asc' } }),
    db.gatheringReceiptAsset.findMany({
      where: { financeYearId: financeYear.id, deletedAt: null, status: 'READY' },
      orderBy: { id: 'asc' },
    }),
    db.gatheringExecutiveTerm.findMany({
      where: { groupId: financeYear.groupId, fiscalYear: financeYear.year },
      orderBy: { id: 'asc' },
    }),
  ]);
  const totals = summarizeLedger(
    financeYear.openingBalanceWon,
    transactions.map((row) => ({ direction: row.direction, amountWon: row.amountWon })),
  );
  return {
    transactions,
    dues,
    receipts,
    officers,
    ack: handoverAck({
      incomeWon: totals.incomeWon,
      expenseWon: totals.expenseWon,
      balanceWon: totals.balanceWon,
      dueCount: dues.length,
      receiptCount: receipts.length,
    }),
  };
}

export async function countPendingReceipts(db: FactDb, financeYearId: string) {
  return db.gatheringReceiptAsset.count({
    where: { financeYearId, status: 'PENDING', deletedAt: null },
  });
}
