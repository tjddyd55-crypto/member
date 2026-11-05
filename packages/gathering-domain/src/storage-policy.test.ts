import { describe, expect, it } from 'vitest';
import {
  ANNUAL_GROUP_FEE_WON,
  STORAGE_QUOTA_BYTES,
  billableStorageBytes,
  canDeleteStoredObject,
  evaluateUpload,
} from './storage-policy.js';
import { parseWon } from './money.js';

const underQuota = {
  mediaBytes: 10_000_000_000,
  receiptBytes: 1_000_000_000,
  otherBytes: 0,
};

describe('저장 용량과 영수증 보존', () => {
  it('연 회비와 한도를 단일 요금제 상수로 고정한다', () => {
    expect(ANNUAL_GROUP_FEE_WON).toBe(30_000);
    expect(STORAGE_QUOTA_BYTES).toBe(50_000_000_000);
  });

  it('영수증 바이트를 50GB 한도에 포함한다', () => {
    expect(billableStorageBytes(underQuota)).toBe(11_000_000_000);
    const decision = evaluateUpload({
      usage: {
        mediaBytes: 49_000_000_000,
        receiptBytes: 1_000_000_000,
        otherBytes: 0,
      },
      kind: 'RECEIPT',
      additionalBytes: 1,
    });
    expect(decision).toEqual({ allowed: false, reason: 'QUOTA_EXCEEDED' });
  });

  it('이용권이 없어도 한도 안의 사진과 영수증은 허용한다', () => {
    expect(evaluateUpload({ usage: underQuota, kind: 'MEDIA', additionalBytes: 1 })).toEqual({ allowed: true });
    expect(evaluateUpload({ usage: underQuota, kind: 'RECEIPT', additionalBytes: 1 })).toEqual({ allowed: true });
  });

  it('마감된 영수증은 삭제하지 않고, 마감은 미디어 삭제를 잠그지 않는다', () => {
    expect(
      canDeleteStoredObject({ kind: 'RECEIPT', financeYearClosed: true, actor: 'TREASURER' }),
    ).toBe(false);
    expect(
      canDeleteStoredObject({ kind: 'RECEIPT', financeYearClosed: false, actor: 'TREASURER' }),
    ).toBe(true);
    expect(
      canDeleteStoredObject({ kind: 'RECEIPT', financeYearClosed: false, actor: 'UPLOADER' }),
    ).toBe(false);
    expect(
      canDeleteStoredObject({ kind: 'MEDIA', financeYearClosed: true, actor: 'UPLOADER' }),
    ).toBe(true);
    expect(
      canDeleteStoredObject({ kind: 'MEDIA', financeYearClosed: false, actor: 'MODERATOR' }),
    ).toBe(true);
    expect(canDeleteStoredObject({ kind: 'MEDIA', financeYearClosed: false, actor: 'OTHER' })).toBe(
      false,
    );
  });
});

describe('원화 금액', () => {
  it('정수 원만 받고 소수와 0원은 거절한다', () => {
    expect(parseWon(12000)).toEqual({ ok: true, value: 12000 });
    expect(parseWon(12.5).ok).toBe(false);
    expect(parseWon(0).ok).toBe(false);
    expect(parseWon(-1).ok).toBe(false);
  });
});
