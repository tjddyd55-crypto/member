export const REMINDER_WINDOW_MS = 60 * 60 * 1000;

export const NOTICE_KINDS = ['EVENT_CREATED', 'EVENT_UPDATED', 'EVENT_REMINDER'] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** 같은 사용자·같은 행사 버전에는 알림을 한 번만 만든다. */
export function notificationDedupeKey(input: {
  kind: NoticeKind;
  eventId: string;
  userId: string;
  version: string;
}) {
  return `${input.kind}:${input.eventId}:${input.userId}:${input.version}`;
}

export function isInsideReminderWindow(startsAt: Date, now: Date) {
  const delta = startsAt.getTime() - now.getTime();
  return delta >= 0 && delta <= REMINDER_WINDOW_MS;
}
