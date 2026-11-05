import { describe, expect, it } from 'vitest';
import { instantInsideOpenYear } from '../modules/gathering/finance/open-year-instant.js';

const year = {
  startsAt: '2025-12-23T15:00:00.000Z',
  endsAt: '2026-12-23T14:59:59.999Z',
};

describe('열린 회계연도 시각', () => {
  it('한 시간 뒤가 연도를 넘기면 오늘 시각을 고른다', () => {
    const now = Date.parse(year.endsAt) - 30 * 60 * 1000;
    const picked = Date.parse(instantInsideOpenYear(year, now));
    expect(picked).toBe(now);
    expect(picked).toBeLessThanOrEqual(Date.parse(year.endsAt));
  });

  it('여유가 있으면 한 시간 뒤를 고른다', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(instantInsideOpenYear(year, now)).toBe(new Date(now + 60 * 60 * 1000).toISOString());
  });
});
