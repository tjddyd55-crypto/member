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

/** 회비 납부액은 행사 수입과 따로 한 번만 합계에 넣는다. */
export function summarizeFinance(input: {
  openingBalanceWon: number;
  entries: readonly LedgerEntry[];
  duesPaidWon: number;
}): LedgerTotals & { eventIncomeWon: number; duesWon: number } {
  const ledger = summarizeLedger(input.openingBalanceWon, input.entries);
  return {
    eventIncomeWon: ledger.incomeWon,
    duesWon: input.duesPaidWon,
    incomeWon: ledger.incomeWon + input.duesPaidWon,
    expenseWon: ledger.expenseWon,
    balanceWon: ledger.balanceWon + input.duesPaidWon,
  };
}

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
