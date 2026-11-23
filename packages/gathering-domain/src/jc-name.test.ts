import { describe, expect, it } from 'vitest';
import { normalizeJcName } from './jc-name.js';

describe('normalizeJcName', () => {
  it.each([
    '서울광진 JC',
    '서울광진JC',
    '서울광진청년회의소',
    '서울광진',
    '서울·(광진) - 제이씨.',
    '서울광진 로컬jc',
  ])('normalizes %s to the same local name', (value) =>
    expect(normalizeJcName(value)).toBe('서울광진'),
  );

  it('folds decomposed Korean and strips 지구 only for district matching', () => {
    expect(normalizeJcName('서울지구JC'.normalize('NFD'), 'DISTRICT')).toBe('서울');
    expect(normalizeJcName('서울지구JC')).toBe('서울지구');
  });
});
