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

export function fiscalYearOf(instant: Date): number {
  const parts = kstParts(instant);
  if (parts.month === 12 && parts.day >= 24) return parts.year + 1;
  return parts.year;
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

export function fiscalYearRange(fiscalYear: number): FiscalYearRange {
  return {
    fiscalYear,
    startsAt: atKst(fiscalYear - 1, 12, 24, 0, 0, 0, 0),
    endsAt: atKst(fiscalYear, 12, 23, 23, 59, 59, 999),
  };
}

export type PaymentAttribution = {
  eventFiscalYear: number;
  paymentFiscalYear: number;
  sameFiscalYear: boolean;
};

/** 행사와 결제일을 함께 보여 주되, 장부 귀속은 paymentFiscalYear 를 따른다. */
export function attributePayment(input: { eventStartsAt: Date; paidAt: Date }): PaymentAttribution {
  const eventFiscalYear = fiscalYearOf(input.eventStartsAt);
  const paymentFiscalYear = fiscalYearOf(input.paidAt);
  return {
    eventFiscalYear,
    paymentFiscalYear,
    sameFiscalYear: eventFiscalYear === paymentFiscalYear,
  };
}
