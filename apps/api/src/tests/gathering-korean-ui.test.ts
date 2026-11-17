import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withRo } from '../../../gathering-mobile/src/utils/korean';

describe('직책의 로/으로 조사', () => {
  it.each([
    ['총무', '총무로'],
    ['재무', '재무로'],
    ['협의회장', '협의회장으로'],
    ['조직관리', '조직관리로'],
    ['대외협력이사', '대외협력이사로'],
    ['총괄', '총괄로'],
    ['운영', '운영으로'],
    [' 재무 ', '재무로'],
    ['', ''],
  ])('%s → %s', (word, expected) => expect(withRo(word)).toBe(expected));

  it('회원 목록과 임원 화면이 공유하는 임명 확인에 적용한다', () => {
    const source = readFileSync(
      new URL(
        '../../../gathering-mobile/src/features/group/MemberPickerSheet.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).toContain("withRo(target?.label ?? '')");
    expect(source).not.toContain('${target?.label}으로');
  });
});
