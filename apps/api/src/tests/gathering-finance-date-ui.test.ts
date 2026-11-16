import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('거래 편집의 한국 달력 날짜', () => {
  it.each(['America/Los_Angeles', 'Asia/Seoul', 'UTC', 'Pacific/Kiritimati'])(
    '%s 기기에서 편집·저장해도 KST 결제일과 연도 경계를 유지한다',
    (timezone) => {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
        import assert from 'node:assert/strict';
        import { calendarDateFromPaidAt, paidAtFromCalendarDate, dateInputValue } from './apps/gathering-mobile/src/features/forms/values.ts';
        for (const [paidAt, calendar, saved] of [
          ['2026-11-16T03:00:00.000Z', '2026-11-16', '2026-11-16T03:00:00.000Z'],
          ['2026-12-23T15:00:00.000Z', '2026-12-24', '2026-12-24T03:00:00.000Z'],
          ['2026-12-31T15:00:00.000Z', '2027-01-01', '2027-01-01T03:00:00.000Z'],
          ['2026-07-01T03:00:00.000Z', '2026-07-01', '2026-07-01T03:00:00.000Z'],
        ]) {
          const picker = calendarDateFromPaidAt(paidAt);
          assert.equal(dateInputValue(picker), calendar);
          assert.equal(paidAtFromCalendarDate(picker), saved);
        }
      `,
        ],
        {
          cwd: resolve(import.meta.dirname, '../../../..'),
          env: { ...process.env, TZ: timezone },
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
    },
  );
  it('편집 모달은 원래 시각 대신 KST 달력 날짜로 프리필한다', () => {
    const source = readFileSync(
      new URL('../../../gathering-mobile/src/features/finance/FinancePanes.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('setPaidOn(calendarDateFromPaidAt(item.paidAt))');
    expect(source).not.toContain('setPaidOn(new Date(item.paidAt))');
  });
});
