import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalJson, handoverAck, summarizeFinance } from '@member/gathering-domain';

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
  const totals = summarizeFinance({
    openingBalanceWon: financeYear.openingBalanceWon,
    entries: transactions.map((row) => ({ direction: row.direction, amountWon: row.amountWon })),
    duesPaidWon: dues.reduce((sum, row) => sum + row.paidAmountWon, 0),
  });
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
    fingerprint: financeFingerprint({ transactions, dues, receipts }),
  };
}

function financeFingerprint(input: {
  transactions: Array<{
    id: string;
    direction: string;
    label: string;
    amountWon: number;
    paidAt: Date;
    note: string | null;
    adjustment: boolean;
  }>;
  dues: Array<{
    id: string;
    userId: string;
    amountWon: number;
    paidAmountWon: number;
    paidAt: Date | null;
    status: string;
  }>;
  receipts: Array<{
    id: string;
    storageKey: string;
    checksum: string | null;
    version: number;
    sizeBytes: bigint;
    mimeType: string;
  }>;
}) {
  return canonicalJson({
    transactions: input.transactions.map((row) => ({
      id: row.id,
      direction: row.direction,
      label: row.label,
      amountWon: row.amountWon,
      paidAt: row.paidAt.toISOString(),
      note: row.note,
      adjustment: row.adjustment,
    })),
    dues: input.dues.map((row) => ({
      id: row.id,
      userId: row.userId,
      amountWon: row.amountWon,
      paidAmountWon: row.paidAmountWon,
      paidAt: row.paidAt?.toISOString() ?? null,
      status: row.status,
    })),
    receipts: input.receipts.map((row) => ({
      id: row.id,
      storageKey: row.storageKey,
      checksum: row.checksum,
      version: row.version,
      sizeBytes: row.sizeBytes.toString(),
      mimeType: row.mimeType,
    })),
  });
}

export async function countPendingReceipts(db: FactDb, financeYearId: string) {
  return db.gatheringReceiptAsset.count({
    where: { financeYearId, status: 'PENDING', deletedAt: null },
  });
}
