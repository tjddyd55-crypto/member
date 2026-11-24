type EventTime = { startsAt: Date | string; endsAt?: Date | string | null };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the instant when the event ends. Use endsAt when set, or midnight
 * after the start date in Asia/Seoul (UTC+9, with no daylight saving time).
 */
export function eventEndInstant({ startsAt, endsAt }: EventTime): Date {
  if (endsAt != null) return new Date(endsAt);

  const kstStart = new Date(startsAt).getTime() + KST_OFFSET_MS;
  const nextKstMidnight = (Math.floor(kstStart / DAY_MS) + 1) * DAY_MS;
  return new Date(nextKstMidnight - KST_OFFSET_MS);
}

/** An event is ended at or after its end instant. Cancellation is handled separately. */
export function hasEventEnded(event: EventTime, now: Date = new Date()): boolean {
  return now.getTime() >= eventEndInstant(event).getTime();
}
