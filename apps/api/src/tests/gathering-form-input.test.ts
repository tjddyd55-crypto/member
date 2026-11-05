import { describe, expect, it } from 'vitest';
import {
  composeAddress,
  dateFromDateInput,
  dateInputValue,
  eventStartsAt,
  fiscalMonthDay,
  focusedFieldScrollY,
  formatKoreanDate,
  keyboardAvoidingBehavior,
  paidAtFromCalendarDate,
  parsePostcodeMessage,
  uploadLinkStatus,
} from '../../../gathering-mobile/src/features/forms/values';

describe('모임 입력', () => {
  it('날짜와 시간은 피커 값으로 기존 시각 변환을 쓴다', () => {
    const startsAt = eventStartsAt(new Date(2026, 10, 20, 1, 2, 3), new Date(2026, 0, 1, 19, 30, 45));
    expect(startsAt).toBe(new Date('2026-11-20T19:30:00').toISOString());
    expect(paidAtFromCalendarDate(new Date(2026, 10, 20, 23, 15))).toBe('2026-11-20T03:00:00.000Z');
    expect(fiscalMonthDay(new Date(2024, 2, 1, 8))).toEqual({ fiscalStartMonth: 3, fiscalStartDay: 1 });
    expect(formatKoreanDate(new Date(2026, 10, 20))).toContain('2026');
    const picked = new Date(2026, 10, 20, 19, 30, 0);
    expect(dateInputValue(picked)).toBe('2026-11-20');
    expect(dateFromDateInput('2026-12-01', picked)?.getMonth()).toBe(11);
    expect(dateFromDateInput('2026-12-01', picked)?.getDate()).toBe(1);
    expect(dateFromDateInput('nope', picked)).toBeNull();
  });

  it('주소 검색 결과는 도로명에 상세 주소를 붙인다', () => {
    expect(parsePostcodeMessage(JSON.stringify({ roadAddress: '서울 중구 세종대로 110', jibunAddress: '지번' }))).toBe(
      '서울 중구 세종대로 110',
    );
    expect(parsePostcodeMessage('{}')).toBeNull();
    expect(composeAddress('서울 중구 세종대로 110', '101호')).toBe('서울 중구 세종대로 110 101호');
    expect(composeAddress('서울 중구 세종대로 110', '')).toBe('서울 중구 세종대로 110');
  });

  it('키보드가 열려도 포커스된 칸으로 스크롤할 위치를 남긴다', () => {
    expect(keyboardAvoidingBehavior('ios')).toBe('padding');
    expect(keyboardAvoidingBehavior('android')).toBeUndefined();
    expect(focusedFieldScrollY(80)).toBe(56);
    expect(focusedFieldScrollY(10)).toBe(0);
  });

  it('업로드 링크 상태는 만료와 중지와 폐기를 한글로 구분한다', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    expect(uploadLinkStatus({ expiresAt: future })).toBe('사용 중');
    expect(uploadLinkStatus({ expiresAt: future, pausedAt: past })).toBe('일시중지');
    expect(uploadLinkStatus({ expiresAt: past })).toBe('만료됨');
    expect(uploadLinkStatus({ expiresAt: future, revokedAt: past })).toBe('폐기됨');
  });
});