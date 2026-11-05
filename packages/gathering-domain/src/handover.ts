export const HANDOVER_STATUSES = ['NOMINATED', 'ACCEPTED', 'CONFIRMED', 'FINALIZED', 'CANCELLED'] as const;

export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export type HandoverAction = 'ACCEPT' | 'CONFIRM' | 'FINALIZE' | 'CANCEL';

/** 지명 → 수락 → 현 회장 확인 → 최종 승인. 순서가 아니면 null. */
export function applyHandover(status: HandoverStatus, action: HandoverAction): HandoverStatus | null {
  if (action === 'CANCEL' && status !== 'FINALIZED' && status !== 'CANCELLED') return 'CANCELLED';
  if (status === 'NOMINATED' && action === 'ACCEPT') return 'ACCEPTED';
  if (status === 'ACCEPTED' && action === 'CONFIRM') return 'CONFIRMED';
  if (status === 'CONFIRMED' && action === 'FINALIZE') return 'FINALIZED';
  return null;
}

export type HandoverAck = {
  incomeWon: number;
  expenseWon: number;
  balanceWon: number;
  dueCount: number;
  receiptCount: number;
};

export function handoverAck(input: HandoverAck): HandoverAck {
  return {
    incomeWon: input.incomeWon,
    expenseWon: input.expenseWon,
    balanceWon: input.balanceWon,
    dueCount: input.dueCount,
    receiptCount: input.receiptCount,
  };
}
