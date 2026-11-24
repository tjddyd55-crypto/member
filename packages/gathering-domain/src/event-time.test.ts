import { describe, expect, it } from 'vitest';
import { eventEndInstant, hasEventEnded } from './event-time.js';

describe('event end time', () => {
  it.each([
    ['2026-11-30T20:00:00+09:00', false],
    ['2026-11-30T19:00:00+09:00', true],
    ['2026-11-30T18:30:00+09:00', true],
  ])('uses the explicit end instant %s', (endsAt, expected) => {
    const event = { startsAt: new Date('2026-11-30T18:00:00+09:00'), endsAt };
    expect(eventEndInstant(event)).toEqual(new Date(endsAt));
    expect(hasEventEnded(event, new Date('2026-11-30T19:00:00+09:00'))).toBe(expected);
  });

  it.each([
    '2026-11-30T18:00:00+09:00',
    '2026-11-30T23:30:00+09:00',
    '2026-11-30T00:00:00+09:00',
    '2026-11-29T16:30:00Z',
  ])('ends at the next KST midnight for start %s', (startsAt) => {
    const event = { startsAt, endsAt: null };
    const midnight = new Date('2026-12-01T00:00:00+09:00');
    expect(eventEndInstant(event)).toEqual(midnight);
    expect(hasEventEnded(event, new Date(midnight.getTime() - 1))).toBe(false);
    expect(hasEventEnded(event, midnight)).toBe(true);
  });
});
