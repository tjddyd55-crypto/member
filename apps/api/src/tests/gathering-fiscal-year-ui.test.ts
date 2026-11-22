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
  it('합계와 행사 장부 탭 사이에 일반 장부를 표시한다', () => {
    expect(pane).toContain('행사 수입');
    expect(pane).toContain('일반 수입');
    expect(pane).toContain('회비');
    expect(pane.indexOf('일반 수입·지출')).toBeGreaterThan(pane.indexOf('summary.generalIncomeWon'));
    expect(pane.indexOf('일반 수입·지출')).toBeLessThan(pane.indexOf('행사별 장부'));
  });
  it('기존 회계연도 카드 목록을 제거한다', () => {
    expect(pane).not.toContain('{item.year} 회계연도');
    expect(pane).not.toContain('summary.years.map');
  });
});

it('설정에서 자동 회계연도 안내와 선택한 해의 저장 기간을 표시한다', () => {
  const source = readFileSync(
    new URL('../../../gathering-mobile/app/(app)/groups/%5BgroupId%5D/settings.tsx', import.meta.url),
    'utf8',
  );
  expect(source).toContain('회계연도는 매년 1월 1일부터 12월 31일까지입니다 (자동).');
  expect(source).toContain('formatRange(selected.startsAt, selected.endsAt)');
  expect(source).not.toContain('DateTimeField');
  expect(source).not.toContain('회계 시작일 저장');
});
