import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gatheringRegisterSchema } from '@member/contracts';

const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');

describe('가입 오류 피드백', () => {
  it('가입 화면은 오류 상자와 알림, 비밀번호 안내를 제공한다', () => {
    const register = source('app/(auth)/register.tsx');
    for (const text of ['<FormError>', 'Alert.alert(', '가입할 수 없습니다', '8자 이상, 영문·숫자 포함'])
      expect(register).toContain(text);
    expect(register.indexOf('Keyboard.dismiss()')).toBeLessThan(register.indexOf('.safeParse('));
    const ui = source('src/design/ui.tsx');
    expect(ui).toContain('accessibilityRole="alert"');
    expect(ui).toContain('accessibilityLiveRegion="polite"');
  });

  it.each([
    ['name', '', '이름을 입력하세요.'],
    ['localJcName', '', '소속 로컬을 입력하세요.'],
    ['phone', '010', '휴대폰 번호를 정확히 입력하세요.'],
    ['password', 'abc1', '비밀번호는 8자 이상이어야 합니다.'],
    ['password', '12345678', '비밀번호에 영문을 포함하세요.'],
    ['directoryConsent', false, '모임 안 연락처 공개에 동의해야 합니다.'],
  ])('%s 검증 실패는 한국어로 안내한다', (field, value, message) => {
    const result = gatheringRegisterSchema.safeParse({
      name: '홍길동',
      localJcName: '서울',
      phone: '01012345678',
      password: 'password1',
      directoryConsent: true,
      [field]: value,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message);
  });
});
