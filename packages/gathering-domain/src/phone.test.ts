import { describe, expect, it } from 'vitest';
import { normalizeKoreanMobile } from './phone.js';

describe('휴대폰 번호 정규화', () => {
  it('하이픈과 국가번호를 010 번호로 맞춘다', () => {
    expect(normalizeKoreanMobile('010-1234-5678')).toBe('01012345678');
    expect(normalizeKoreanMobile('+82 10 1234 5678')).toBe('01012345678');
  });

  it('휴대폰이 아니면 계정을 만들지 않도록 null을 반환한다', () => {
    expect(normalizeKoreanMobile('0212345678')).toBeNull();
    expect(normalizeKoreanMobile('0101234567')).toBeNull();
    expect(normalizeKoreanMobile('')).toBeNull();
  });
});
