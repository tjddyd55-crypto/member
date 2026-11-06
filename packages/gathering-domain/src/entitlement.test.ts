import { describe, expect, it } from 'vitest';
import {
  FORMAL_ANNUAL_FEE_WON,
  TRIAL_DAYS,
  canOpenTrial,
  evaluateEntitlement,
  formalTermExpiry,
  trialWindow,
} from './entitlement.js';
import { ANNUAL_GROUP_FEE_WON } from './storage-policy.js';

const now = new Date('2026-11-06T05:00:00.000Z');

describe('모임 이용 기간', () => {
  it('새 모임 체험은 요청 시각부터 30일이다', () => {
    const window = trialWindow(now);
    expect(window.startsAt.toISOString()).toBe(now.toISOString());
    expect(window.expiresAt.getTime() - window.startsAt.getTime()).toBe(TRIAL_DAYS * 24 * 60 * 60 * 1000);
  });

  it('정식 요금은 6만 원이고 예전 3만 원 상수는 이력용으로 남긴다', () => {
    expect(FORMAL_ANNUAL_FEE_WON).toBe(60_000);
    expect(ANNUAL_GROUP_FEE_WON).toBe(30_000);
  });

  it('갱신은 남은 만료에 1년을 더하고, 지난 만료는 승인 시각부터 1년이다', () => {
    const later = new Date('2026-12-01T00:00:00.000Z');
    const renewed = formalTermExpiry(now, later, now);
    expect(renewed.toISOString()).toBe('2027-12-01T00:00:00.000Z');
    const fresh = formalTermExpiry(now, new Date('2026-01-01T00:00:00.000Z'), now);
    expect(fresh.toISOString()).toBe('2027-11-06T05:00:00.000Z');
    const scheduled = formalTermExpiry(new Date('2027-01-01T00:00:00.000Z'), later, now);
    expect(scheduled.toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });

  it('같은 모임 행의 두 번째 체험만 열지 않는다', () => {
    expect(canOpenTrial(false)).toBe(true);
    expect(canOpenTrial(true)).toBe(false);
  });

  it('정지와 만료는 새 입력을 막고 읽기와 계정 조회는 남긴다', () => {
    expect(evaluateEntitlement({ suspended: false, covered: true, action: 'WRITE' })).toEqual({ allowed: true });
    expect(evaluateEntitlement({ suspended: true, covered: true, action: 'WRITE' })).toEqual({
      allowed: false,
      reason: 'SUSPENDED',
    });
    expect(evaluateEntitlement({ suspended: false, covered: false, action: 'WRITE' })).toEqual({
      allowed: false,
      reason: 'ENTITLEMENT_REQUIRED',
    });
    expect(evaluateEntitlement({ suspended: true, covered: false, action: 'READ' })).toEqual({ allowed: true });
    expect(evaluateEntitlement({ suspended: true, covered: false, action: 'ACCOUNT' })).toEqual({ allowed: true });
  });
});
