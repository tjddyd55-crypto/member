import { kstDateKey } from './fiscal-year.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionNoticeWindow = 'DAYS_30' | 'DAYS_7' | 'DAY_0';

/** 승인 시각부터 1년. 윤년은 UTC 달력 기준으로 같은 시각을 다음 해에 둔다. */
export function subscriptionExpiry(startsAt: Date): Date {
  const expires = new Date(startsAt.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return expires;
}

/**
 * 만료 30일, 7일, 당일(한국 달력)에 한 번씩 알린다.
 * 이미 지난 이용권은 알림 창이 아니다.
 */
export function subscriptionNoticeWindow(expiresAt: Date, now: Date): SubscriptionNoticeWindow | null {
  if (now.getTime() >= expiresAt.getTime()) return null;
  if (kstDateKey(now) === kstDateKey(expiresAt)) return 'DAY_0';
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 7 * DAY_MS) return 'DAYS_7';
  if (remaining <= 30 * DAY_MS) return 'DAYS_30';
  return null;
}

export function subscriptionNoticeDedupeKey(input: {
  groupId: string;
  userId: string;
  expiresAt: Date;
  window: SubscriptionNoticeWindow;
}) {
  return `SUBSCRIPTION:${input.window}:${input.groupId}:${input.expiresAt.toISOString()}:${input.userId}`;
}
