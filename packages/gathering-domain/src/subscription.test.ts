import { describe, expect, it } from 'vitest';
import { subscriptionExpiry, subscriptionNoticeDedupeKey, subscriptionNoticeWindow } from './subscription.js';

describe('모임 이용권 기간', () => {
  it('승인 시각부터 1년 뒤에 끝난다', () => {
    const starts = new Date('2026-03-01T00:00:00.000Z');
    expect(subscriptionExpiry(starts).toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });

  it('30일, 7일, 만료 당일에만 알림 창을 연다', () => {
    const expires = new Date('2026-12-01T00:00:00.000Z');
    expect(subscriptionNoticeWindow(expires, new Date('2026-10-01T00:00:00.000Z'))).toBeNull();
    expect(subscriptionNoticeWindow(expires, new Date('2026-11-10T00:00:00.000Z'))).toBe('DAYS_30');
    expect(subscriptionNoticeWindow(expires, new Date('2026-11-28T00:00:00.000Z'))).toBe('DAYS_7');
    expect(subscriptionNoticeWindow(expires, new Date('2026-11-30T16:00:00.000Z'))).toBe('DAY_0');
    expect(subscriptionNoticeWindow(expires, expires)).toBe('DAY_0');
    expect(subscriptionNoticeWindow(expires, new Date('2026-12-01T15:00:00.000Z'))).toBeNull();
  });

  it('같은 만료 시각의 알림은 한 번만 만든다', () => {
    const key = subscriptionNoticeDedupeKey({
      groupId: 'g',
      userId: 'u',
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      window: 'DAYS_7',
    });
    expect(key).toBe(subscriptionNoticeDedupeKey({
      groupId: 'g',
      userId: 'u',
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      window: 'DAYS_7',
    }));
  });
});
