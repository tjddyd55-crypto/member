import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/src/${path}`, import.meta.url), 'utf8');

describe('업로드 진행 화면 구조', () => {
  it('미디어는 바이트와 전체 파일 목록 대신 공통 진행 막대와 개수를 표시한다', () => {
    const media = source('features/media/MediaPane.tsx');
    expect(media).not.toContain('전송 {progress.loaded}');
    expect(media).not.toContain('loaded}/{');
    expect(media).not.toContain('{jobs.map(');
    expect(media).toContain('<ProgressBar percent={progress.percent}');
    expect(media).toContain('{progress.completed}/{progress.count}');
    expect(media).toContain("? '장' : '개'");
    expect(media).toContain("job.file.kind === 'PHOTO'");
    expect(media).toContain('실패한 항목 모두 다시 시도');
    expect(media).toContain('numberOfLines={1}');
    expect(media).toContain('jobs.filter((job) => canRetryTransfer(job.state))');
  });
  it('공통 진행 막대는 접근성 값과 6px 트랙을 제공한다', () => {
    const bar = source('design/ProgressBar.tsx');
    expect(bar).toContain('accessibilityRole="progressbar"');
    expect(bar).toContain('accessibilityValue={{ min: 0, max: 100, now: value }}');
    expect(bar).toContain('height: 6');
    expect(bar).toContain('theme.colors.primary.default');
  });
  it('영수증도 같은 진행 막대와 장수를 표시한다', () => {
    const finance = source('features/finance/FinancePanes.tsx');
    expect(finance).toContain('<ProgressBar percent={progress.percent}');
    expect(finance).toContain('영수증 {progress.index}/{progress.count}장');
  });
});
