import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fiscalYearLabel } from '../../../gathering-mobile/src/features/finance/fiscal-year';

const years = [2028, 2025, 2027, 2026, 2024].map((year) => ({
  year,
  startsAt: `${year}-04-01T00:00:00Z`,
  endsAt: `${year + 1}-03-31T23:59:59.999Z`,
}));

describe('회계연도 상대 표시', () => {
  const now = new Date('2027-02-01T00:00:00Z');
  it.each([
    [2026, '올해'],
    [2025, '작년'],
    [2027, '내년'],
    [2024, null],
    [2028, null],
    [2030, null],
  ])('%s: %s', (year, label) => expect(fiscalYearLabel(year as number, years, now)).toBe(label));
  it('현재 기간이 없으면 상대 표시를 생략한다', () => {
    expect(fiscalYearLabel(2026, years, new Date('2030-01-01'))).toBeNull();
    expect(fiscalYearLabel(2026, [], now)).toBeNull();
  });
  it('기간의 시작과 끝을 포함한다', () => {
    expect(fiscalYearLabel(2026, years, new Date(years[3].startsAt))).toBe('올해');
    expect(fiscalYearLabel(2026, years, new Date(years[3].endsAt))).toBe('올해');
  });
});

describe('그룹 회계 화면 구조', () => {
  const source = readFileSync(
    new URL('../../../gathering-mobile/src/features/finance/FinancePanes.tsx', import.meta.url),
    'utf8',
  );
  const pane = source.slice(
    source.indexOf('export function GroupFinancePane'),
    source.indexOf('function MoneyCard'),
  );
  it('기초잔액 앞에 회계연도 탭을 렌더링한다', () => {
    expect(pane.indexOf('<FiscalYearTabs')).toBeGreaterThan(-1);
    expect(pane.indexOf('<FiscalYearTabs')).toBeLessThan(
      pane.indexOf('<MoneyCard label="기초잔액"'),
    );
  });
  it('기존 회계연도 카드 목록을 제거한다', () => {
    expect(pane).not.toContain('{item.year} 회계연도');
    expect(pane).not.toContain('summary.years.map');
  });
});
