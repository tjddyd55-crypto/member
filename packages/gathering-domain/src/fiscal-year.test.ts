import { describe, expect, it } from 'vitest';
import { attributePayment, fiscalYearOf, fiscalYearRange } from './fiscal-year.js';

function kst(isoLocal: string): Date {
  return new Date(`${isoLocal}+09:00`);
}

describe('회계연도 귀속', () => {
  it('12월 24일부터 다음 해 12월 23일까지를 한 회계연도로 본다', () => {
    const range = fiscalYearRange(2026);
    expect(range.startsAt.toISOString()).toBe(kst('2025-12-24T00:00:00.000').toISOString());
    expect(range.endsAt.toISOString()).toBe(kst('2026-12-23T23:59:59.999').toISOString());
    expect(fiscalYearOf(range.startsAt)).toBe(2026);
    expect(fiscalYearOf(range.endsAt)).toBe(2026);
    expect(fiscalYearOf(new Date(range.endsAt.getTime() + 1))).toBe(2027);
  });

  it('12월 23일 밤 결제는 그 해, 자정을 넘긴 12월 24일 결제는 다음 해다', () => {
    expect(fiscalYearOf(kst('2026-12-23T23:30:00.000'))).toBe(2026);
    expect(fiscalYearOf(kst('2026-12-24T00:00:00.000'))).toBe(2027);
    expect(fiscalYearOf(kst('2026-12-24T00:30:00.000'))).toBe(2027);
  });

  it('UTC 자정과 한국시간 자정을 혼동하지 않는다', () => {
    expect(fiscalYearOf(new Date('2026-12-23T15:00:00.000Z'))).toBe(2027);
    expect(fiscalYearOf(new Date('2026-12-23T14:59:59.999Z'))).toBe(2026);
  });

  it('행사 다음 날 새벽 결제는 같은 행사에 두되 귀속 연도는 결제일 기준이다', () => {
    const sameYear = attributePayment({
      eventStartsAt: kst('2026-10-28T21:00:00.000'),
      paidAt: kst('2026-10-29T00:40:00.000'),
    });
    expect(sameYear.sameFiscalYear).toBe(true);
    expect(sameYear.paymentFiscalYear).toBe(2026);

    const boundary = attributePayment({
      eventStartsAt: kst('2026-12-23T22:00:00.000'),
      paidAt: kst('2026-12-24T00:30:00.000'),
    });
    expect(boundary.eventFiscalYear).toBe(2026);
    expect(boundary.paymentFiscalYear).toBe(2027);
    expect(boundary.sameFiscalYear).toBe(false);
  });
});
