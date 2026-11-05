import { describe, expect, it } from 'vitest';
import { dueStanding, summarizeLedger } from './ledger.js';
import { parseWonAllowZero } from './money.js';
import { validateReceiptUpload } from './receipt-policy.js';

describe('행사 장부 합계', () => {
  it('기초잔액에 수입을 더하고 지출을 뺀다', () => {
    expect(
      summarizeLedger(1000, [
        { direction: 'INCOME', amountWon: 5000 },
        { direction: 'EXPENSE', amountWon: 700 },
      ]),
    ).toEqual({ incomeWon: 5000, expenseWon: 700, balanceWon: 5300 });
  });

  it('납부액으로 회비 상태를 나누고 0원을 납부액으로만 허용한다', () => {
    expect(dueStanding(10000, 0)).toBe('UNPAID');
    expect(dueStanding(10000, 4000)).toBe('PARTIAL');
    expect(dueStanding(10000, 10000)).toBe('PAID');
    expect(parseWonAllowZero(0)).toEqual({ ok: true, value: 0 });
    expect(parseWonAllowZero(1500)).toEqual({ ok: true, value: 1500 });
    expect(parseWonAllowZero(1.5).ok).toBe(false);
  });
});

describe('영수증 형식', () => {
  it('이미지와 PDF만 크기 안에서 받는다', () => {
    expect(validateReceiptUpload({ mimeType: 'application/pdf', sizeBytes: 1000 })).toEqual({ ok: true });
    expect(validateReceiptUpload({ mimeType: 'image/gif', sizeBytes: 1000 }).ok).toBe(false);
    expect(validateReceiptUpload({ mimeType: 'application/pdf', sizeBytes: 20_000_001 }).ok).toBe(false);
  });
});
