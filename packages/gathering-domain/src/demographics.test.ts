import { describe, expect, it } from 'vitest';
import {
  formatMemberDemographics,
  isAllowedBirthDate,
  isIsoCalendarDate,
  koreanAge,
  parseBirthDate,
  sexLabel,
} from './demographics.js';

describe('만 나이와 생년월일', () => {
  it('computes Korean age on the KST calendar date, including the UTC midnight boundary', () => {
    expect(koreanAge('2000-03-01', new Date('2026-03-01T00:00:00+09:00'))).toBe(26);
    expect(koreanAge('2000-03-01', new Date('2026-02-28T23:59:59.999+09:00'))).toBe(25);
    expect(koreanAge('2000-03-01', new Date('2026-02-28T15:00:00.000Z'))).toBe(26);
  });

  it('rejects impossible, future, or out-of-range dates and never treats a resident number as a date', () => {
    expect(isIsoCalendarDate('2026-02-31')).toBe(false);
    expect(isAllowedBirthDate('2026-11-24', new Date('2026-11-23T15:00:00+09:00'))).toBe(false);
    expect(isAllowedBirthDate('1899-12-31', new Date('2026-11-23T00:00:00+09:00'))).toBe(false);
    expect(isAllowedBirthDate('1900-01-15', new Date('2026-11-23T00:00:00+09:00'))).toBe(false);
    expect(isAllowedBirthDate('1950-01-15', new Date('2026-11-23T00:00:00+09:00'))).toBe(true);
    expect(parseBirthDate('1990-03-15')?.toISOString()).toBe('1990-03-15T00:00:00.000Z');
    expect(parseBirthDate('900315-1')).toBeNull();
  });

  it('formats visible demographics and omits the line when nothing is stored', () => {
    expect(formatMemberDemographics({ birthDate: null, age: null, sex: null })).toBeNull();
    expect(formatMemberDemographics({ birthDate: '1990-03-15', age: 36, sex: 'MALE' })).toBe(
      '1990.03.15 · 만 36세 · 남',
    );
    expect(formatMemberDemographics({ birthDate: null, age: null, sex: 'FEMALE' })).toBe('- · - · 여');
    expect(sexLabel('FEMALE')).toBe('여');
  });
});
