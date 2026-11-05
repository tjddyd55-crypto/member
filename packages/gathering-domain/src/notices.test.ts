import { describe, expect, it } from 'vitest';
import { isInsideReminderWindow, notificationDedupeKey, REMINDER_WINDOW_MS } from './notices.js';

describe('행사 알림 중복 방지', () => {
  it('종류, 행사, 사용자, 버전이 같으면 같은 키를 만든다', () => {
    const first = notificationDedupeKey({
      kind: 'EVENT_UPDATED',
      eventId: 'event-1',
      userId: 'user-1',
      version: '2026-11-05T01:00:00.000Z',
    });
    const second = notificationDedupeKey({
      kind: 'EVENT_UPDATED',
      eventId: 'event-1',
      userId: 'user-1',
      version: '2026-11-05T01:00:00.000Z',
    });
    expect(first).toBe(second);
    expect(first).not.toBe(
      notificationDedupeKey({
        kind: 'EVENT_UPDATED',
        eventId: 'event-1',
        userId: 'user-2',
        version: '2026-11-05T01:00:00.000Z',
      }),
    );
  });

  it('시작 1시간 이내만 리마인드 대상이다', () => {
    const now = new Date('2026-11-05T00:00:00.000Z');
    expect(isInsideReminderWindow(new Date(now.getTime() + REMINDER_WINDOW_MS), now)).toBe(true);
    expect(isInsideReminderWindow(new Date(now.getTime() + REMINDER_WINDOW_MS + 1), now)).toBe(
      false,
    );
    expect(isInsideReminderWindow(new Date(now.getTime() - 1), now)).toBe(false);
  });
});
