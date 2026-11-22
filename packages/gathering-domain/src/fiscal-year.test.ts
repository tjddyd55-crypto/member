import { describe, expect, it } from 'vitest';
import { attributePayment, calendarYearKst, calendarYearRange, fiscalWindowsCovering, fiscalYearOf, fiscalYearRange } from './fiscal-year.js';

function kst(isoLocal: string): Date {
  return new Date(`${isoLocal}+09:00`);
}

describe('회계연도 귀속', () => {
  it('1월 1일부터 12월 31일까지를 한 회계연도로 본다', () => {
    const range = fiscalYearRange(2026);
    expect(range.startsAt.toISOString()).toBe(kst('2026-01-01T00:00:00.000').toISOString());
    expect(range.endsAt.toISOString()).toBe(kst('2026-12-31T23:59:59.999').toISOString());
    expect(fiscalYearOf(range.startsAt)).toBe(2026);
    expect(fiscalYearOf(range.endsAt)).toBe(2026);
    expect(fiscalYearOf(new Date(range.endsAt.getTime() + 1))).toBe(2027);
  });

  it('12월 31일 밤 결제는 그 해, 1월 1일 결제는 다음 해다', () => {
    expect(fiscalYearOf(kst('2026-12-31T23:30:00.000'))).toBe(2026);
    expect(fiscalYearOf(kst('2027-01-01T00:00:00.000'))).toBe(2027);
    expect(fiscalYearOf(kst('2027-01-01T00:30:00.000'))).toBe(2027);
  });

  it('UTC 자정과 한국시간 자정을 혼동하지 않는다', () => {
    expect(fiscalYearOf(new Date('2026-12-31T15:00:00.000Z'))).toBe(2027);
    expect(fiscalYearOf(new Date('2026-12-31T14:59:59.999Z'))).toBe(2026);
  });

  it('행사 다음 날 새벽 결제는 같은 행사에 두되 귀속 연도는 결제일 기준이다', () => {
    const sameYear = attributePayment({
      eventStartsAt: kst('2026-10-28T21:00:00.000'),
      paidAt: kst('2026-10-29T00:40:00.000'),
    });
    expect(sameYear.sameFiscalYear).toBe(true);
    expect(sameYear.paymentFiscalYear).toBe(2026);

    const boundary = attributePayment({
      eventStartsAt: kst('2026-12-31T22:00:00.000'),
      paidAt: kst('2027-01-01T00:30:00.000'),
    });
    expect(boundary.eventFiscalYear).toBe(2026);
    expect(boundary.paymentFiscalYear).toBe(2027);
    expect(boundary.sameFiscalYear).toBe(false);
  });

  it('앨범 연도는 한국 달력 연도이며 기본 회계연도와 일치한다', () => {
    expect(calendarYearKst(new Date('2026-12-31T15:30:00.000Z'))).toBe(2027);
    expect(calendarYearKst(kst('2026-12-31T23:00:00.000'))).toBe(2026);
    const range = calendarYearRange(2026);
    expect(calendarYearKst(range.startsAt)).toBe(2026);
    expect(calendarYearKst(range.endsAt)).toBe(2026);
    expect(fiscalYearOf(range.endsAt)).toBe(2026);
  });

  it('모임이 정한 시작일 직전부터 다음 시작 직전까지를 한 해로 본다', () => {
    const june = { startMonth: 6, startDay: 1 };
    const range = fiscalYearRange(2026, june);
    expect(range.startsAt.toISOString()).toBe(kst('2025-06-01T00:00:00.000').toISOString());
    expect(range.endsAt.toISOString()).toBe(kst('2026-05-31T23:59:59.999').toISOString());
    expect(fiscalYearOf(kst('2026-05-31T23:59:59.999'), june)).toBe(2026);
    expect(fiscalYearOf(kst('2026-06-01T00:00:00.000'), june)).toBe(2027);
  });

  it('지정한 기간이 주어진 범위의 시작과 끝을 덮는다', () => {
    const previous = fiscalYearRange(2026);
    const june = { startMonth: 6, startDay: 1 };
    const windows = fiscalWindowsCovering(previous.startsAt, previous.endsAt, june);
    for (const instant of [previous.startsAt, previous.endsAt]) {
      const owner = windows.find((window) => window.startsAt <= instant && instant <= window.endsAt);
      expect(owner?.fiscalYear).toBe(fiscalYearOf(instant, june));
    }
    expect(windows.map((window) => window.fiscalYear)).toEqual([2026, 2027]);
  });

  it('2월 29일 시작은 윤년이 아니면 2월 28일에 시작한다', () => {
    const leapStart = { startMonth: 2, startDay: 29 };
    const leap = fiscalYearRange(2025, leapStart);
    expect(leap.startsAt.toISOString()).toBe(kst('2024-02-29T00:00:00.000').toISOString());
    expect(leap.endsAt.toISOString()).toBe(kst('2025-02-27T23:59:59.999').toISOString());
    const common = fiscalYearRange(2026, leapStart);
    expect(common.startsAt.toISOString()).toBe(kst('2025-02-28T00:00:00.000').toISOString());
  });
});
