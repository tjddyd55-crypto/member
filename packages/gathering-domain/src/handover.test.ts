import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import { applyHandover, handoverAck } from './handover.js';

describe('인계 상태 머신', () => {
  it('지명, 수락, 확인, 최종 승인 순서로만 진행한다', () => {
    expect(applyHandover('NOMINATED', 'ACCEPT')).toBe('ACCEPTED');
    expect(applyHandover('ACCEPTED', 'CONFIRM')).toBe('CONFIRMED');
    expect(applyHandover('CONFIRMED', 'FINALIZE')).toBe('FINALIZED');
    expect(applyHandover('NOMINATED', 'FINALIZE')).toBeNull();
    expect(applyHandover('ACCEPTED', 'FINALIZE')).toBeNull();
    expect(applyHandover('FINALIZED', 'CANCEL')).toBeNull();
    expect(applyHandover('CONFIRMED', 'CANCEL')).toBe('CANCELLED');
  });

  it('확인 해시 원문은 키 순서가 달라도 같다', () => {
    const left = canonicalJson(handoverAck({ incomeWon: 1, expenseWon: 2, balanceWon: 3, dueCount: 4, receiptCount: 5 }));
    const right = canonicalJson({ receiptCount: 5, dueCount: 4, balanceWon: 3, expenseWon: 2, incomeWon: 1 });
    expect(left).toBe(right);
  });
});
