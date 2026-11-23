import { describe, expect, it } from 'vitest';
import {
  composeAddress,
  dateFromDateInput,
  dateInputValue,
  eventStartsAt,
  formatKoreanDate,
  keyboardAvoidingBehavior,
  keyboardBottomPadding,
  keyboardScrollDelta,
  paidAtFromCalendarDate,
  POSTCODE_PAGE,
  parsePostcodeMessage,
  uploadLinkStatus,
} from '../../../gathering-mobile/src/features/forms/values';

describe('모임 입력', () => {
  it('날짜와 시간은 피커 값으로 기존 시각 변환을 쓴다', () => {
    const startsAt = eventStartsAt(new Date(2026, 10, 20, 1, 2, 3), new Date(2026, 0, 1, 19, 30, 45));
    expect(startsAt).toBe(new Date('2026-11-20T19:30:00').toISOString());
    expect(paidAtFromCalendarDate(new Date(2026, 10, 20, 23, 15))).toBe('2026-11-20T03:00:00.000Z');
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
    expect(parsePostcodeMessage(JSON.stringify({
      zonecode: '04986',
      roadAddress: '서울 광진구 천호대로114길 15',
      jibunAddress: '지번',
    }))).toBe('(04986) 서울 광진구 천호대로114길 15');
    expect(parsePostcodeMessage(JSON.stringify({
      zonecode: ' 04986 ',
      roadAddress: ' ',
      jibunAddress: ' 지번 ',
    }))).toBe('(04986) 지번');
    expect(parsePostcodeMessage('{"zonecode":"04986"}')).toBeNull();
    expect(parsePostcodeMessage('not JSON')).toBeNull();
    expect(parsePostcodeMessage('{}')).toBeNull();
    expect(POSTCODE_PAGE).toContain('https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js');
    expect(POSTCODE_PAGE).not.toContain('t1.daumcdn.net');
    expect(POSTCODE_PAGE).toContain('banner: false');
    expect(POSTCODE_PAGE).toContain('useBannerLink: false');
    expect(POSTCODE_PAGE).toContain("zonecode: data.zonecode || ''");
    expect(POSTCODE_PAGE).toContain('ReactNativeWebView.postMessage');
    expect(POSTCODE_PAGE).toContain("window.parent.postMessage(raw, '*')");
    expect(composeAddress('서울 중구 세종대로 110', '101호')).toBe('서울 중구 세종대로 110 101호');
    expect(composeAddress('서울 중구 세종대로 110', '')).toBe('서울 중구 세종대로 110');
  });

  it('키보드가 열려도 포커스된 칸으로 스크롤할 위치를 남긴다', () => {
    expect(keyboardAvoidingBehavior('ios')).toBe('padding');
    expect(keyboardAvoidingBehavior('android')).toBeUndefined();
    expect(keyboardBottomPadding(0)).toBe(120);
    expect(keyboardBottomPadding(50)).toBe(120);
    expect(keyboardBottomPadding(300)).toBe(348);
    expect(keyboardScrollDelta(650, 800, 500)).toBe(174);
    expect(keyboardScrollDelta(480, 490, 500)).toBe(14);
    expect(keyboardScrollDelta(450, 800, 500)).toBe(0);
    expect(keyboardScrollDelta(790, 800)).toBe(14);
  });

  it('업로드 링크 상태는 만료와 중지와 폐기를 한글로 구분한다', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    expect(uploadLinkStatus({ expiresAt: future })).toBe('사용 중');
    expect(uploadLinkStatus({ expiresAt: future, pausedAt: past })).toBe('일시중지');
    expect(uploadLinkStatus({ expiresAt: past })).toBe('만료됨');
    expect(uploadLinkStatus({ expiresAt: past, pausedAt: past })).toBe('만료됨');
    expect(uploadLinkStatus({ expiresAt: future, revokedAt: past })).toBe('폐기됨');
  });
});