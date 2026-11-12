import { describe, expect, it } from 'vitest';
import {
  formatAmountInput,
  parseAmountInput,
  formatWon,
} from '../../../gathering-mobile/src/features/finance/amount';

describe('행사 재무 금액 표시', () => {
  it.each([
    ['', ''],
    ['0', '0'],
    ['000', '0'],
    ['0001500000', '1,500,000'],
    ['1000', '1,000'],
    ['100000', '100,000'],
    ['506000', '506,000'],
    ['1,,500,000원 abc한글', '1,500,000'],
    ['-500,000', '500,000'],
    ['문자만', ''],
    ['1,0000', '10,000'],
    ['1,00', '100'],
  ])('%s 입력은 %s로 표시한다', (raw, expected) => {
    expect(formatAmountInput(raw)).toBe(expected);
    expect(formatAmountInput(expected)).toBe(expected);
  });
  it('붙여넣기와 기존 금액 편집은 기존 숫자 API 타입으로 저장한다', () => {
    expect(parseAmountInput('500,000')).toBe(500000);
    expect(parseAmountInput(formatAmountInput(String(1500000)))).toBe(1500000);
    expect(parseAmountInput('-500원')).toBe(500);
    expect(Number.isSafeInteger(parseAmountInput('99999999999999999999'))).toBe(false);
  });
  it('요약의 수입·지출·음수 차액에 원 단위를 붙인다', () => {
    expect(formatWon(100000)).toBe('100,000원');
    expect(formatWon(506000)).toBe('506,000원');
    expect(formatWon(100000 - 506000)).toBe('-406,000원');
    expect(formatWon(0)).toBe('0원');
  });
});
