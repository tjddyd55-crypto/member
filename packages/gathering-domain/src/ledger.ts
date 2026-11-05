export type LedgerDirection = 'INCOME' | 'EXPENSE';

export type LedgerEntry = {
  direction: LedgerDirection;
  amountWon: number;
};

export type LedgerTotals = {
  incomeWon: number;
  expenseWon: number;
  balanceWon: number;
};

export function summarizeLedger(openingBalanceWon: number, entries: readonly LedgerEntry[]): LedgerTotals {
  const incomeWon = sum(entries, 'INCOME');
  const expenseWon = sum(entries, 'EXPENSE');
  return {
    incomeWon,
    expenseWon,
    balanceWon: openingBalanceWon + incomeWon - expenseWon,
  };
}

export function dueStanding(amountWon: number, paidAmountWon: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paidAmountWon <= 0) return 'UNPAID';
  if (paidAmountWon < amountWon) return 'PARTIAL';
  return 'PAID';
}

function sum(entries: readonly LedgerEntry[], direction: LedgerDirection) {
  return entries.reduce((total, entry) => (entry.direction === direction ? total + entry.amountWon : total), 0);
}
