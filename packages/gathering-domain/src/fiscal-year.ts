/**
 * 모임 회계연도.
 *
 * 회계연도 Y는 한국시간 (Y-1)년 12월 24일 00:00:00.000 부터
 * Y년 12월 23일 23:59:59.999 까지다.
 * 12월 23일이 지나도 자동으로 마감하지 않는다. 마감은 인계 승인 트랜잭션만 한다.
 * 거래의 회계연도는 행사 시작일이 아니라 실제 결제일(paidAt)로 정한다.
 * 저장 시각은 UTC, 경계 판단은 Asia/Seoul(UTC+9, 서머타임 없음)이다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type FiscalYearRange = {
  fiscalYear: number;
  startsAt: Date;
  endsAt: Date;
};

/** 회계연도가 시작되는 달과 날. 기본은 12월 24일. 끝은 다음 시작 직전이다. */
export type FiscalPeriod = {
  startMonth: number;
  startDay: number;
};

export const DEFAULT_FISCAL_PERIOD: FiscalPeriod = { startMonth: 12, startDay: 24 };

export function isValidFiscalPeriod(period: FiscalPeriod) {
  if (!Number.isInteger(period.startMonth) || period.startMonth < 1 || period.startMonth > 12) return false;
  if (!Number.isInteger(period.startDay) || period.startDay < 1) return false;
  return period.startDay <= daysInMonth(2024, period.startMonth);
}

type KstParts = {
  year: number;
  month: number;
  day: number;
};

function kstParts(instant: Date): KstParts {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function atKst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - KST_OFFSET_MS);
}

export function fiscalYearOf(instant: Date, period: FiscalPeriod = DEFAULT_FISCAL_PERIOD): number {
  const parts = kstParts(instant);
  const openedThisYear = startInstant(parts.year, period);
  const startCalendarYear = instant.getTime() >= openedThisYear.getTime() ? parts.year : parts.year - 1;
  return windowStarting(startCalendarYear, period).fiscalYear;
}

/** 앨범 연도는 회계연도가 아니라 행사 시작의 한국 달력 연도다. */
export function calendarYearKst(instant: Date): number {
  return kstParts(instant).year;
}

export function kstDateKey(instant: Date): string {
  const parts = kstParts(instant);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function calendarYearRange(year: number): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: atKst(year, 1, 1, 0, 0, 0, 0),
    endsAt: atKst(year, 12, 31, 23, 59, 59, 999),
  };
}

export function fiscalYearRange(
  fiscalYear: number,
  period: FiscalPeriod = DEFAULT_FISCAL_PERIOD,
): FiscalYearRange {
  for (const startYear of [fiscalYear - 1, fiscalYear]) {
    const window = windowStarting(startYear, period);
    if (window.fiscalYear === fiscalYear) {
      return { fiscalYear, startsAt: window.startsAt, endsAt: window.endsAt };
    }
  }
  throw new Error('회계연도 범위를 계산하지 못했습니다.');
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startInstant(calendarYear: number, period: FiscalPeriod) {
  const day = Math.min(period.startDay, daysInMonth(calendarYear, period.startMonth));
  return atKst(calendarYear, period.startMonth, day, 0, 0, 0, 0);
}

function windowStarting(calendarYear: number, period: FiscalPeriod) {
  const startsAt = startInstant(calendarYear, period);
  const endsAt = new Date(startInstant(calendarYear + 1, period).getTime() - 1);
  return { startsAt, endsAt, fiscalYear: kstParts(endsAt).year };
}

export type PaymentAttribution = {
  eventFiscalYear: number;
  paymentFiscalYear: number;
  sameFiscalYear: boolean;
};

/** 행사와 결제일을 함께 보여 주되, 장부 귀속은 paymentFiscalYear 를 따른다. */
export function attributePayment(input: {
  eventStartsAt: Date;
  paidAt: Date;
  period?: FiscalPeriod;
}): PaymentAttribution {
  const period = input.period ?? DEFAULT_FISCAL_PERIOD;
  const eventFiscalYear = fiscalYearOf(input.eventStartsAt, period);
  const paymentFiscalYear = fiscalYearOf(input.paidAt, period);
  return {
    eventFiscalYear,
    paymentFiscalYear,
    sameFiscalYear: eventFiscalYear === paymentFiscalYear,
  };
}
