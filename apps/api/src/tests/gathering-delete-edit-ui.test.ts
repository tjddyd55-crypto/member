import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mediaDeletePrompt } from '../../../gathering-mobile/src/features/media/delete-values.js';

const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/src/features/${path}`, import.meta.url), 'utf8');
describe('행사 삭제·수정 UI', () => {
  it('종류별 삭제 개수를 안내한다', () => {
    expect(mediaDeletePrompt([{ kind: 'PHOTO' }])).toBe('사진 1개를 삭제할까요?');
    expect(mediaDeletePrompt([{ kind: 'VIDEO' }])).toBe('영상 1개를 삭제할까요?');
    expect(mediaDeletePrompt([{ kind: 'PHOTO' }, { kind: 'PHOTO' }, { kind: 'VIDEO' }])).toBe(
      '사진 2개, 영상 1개를 삭제할까요?',
    );
    expect(mediaDeletePrompt(Array(3).fill({ kind: 'PHOTO' }))).toBe('사진 3개를 삭제할까요?');
  });
  it('권한·선택·뷰어 인덱스와 거래 잠금 안내를 유지한다', () => {
    const media = source('media/MediaPane.tsx');
    expect(media).toContain('!item.canDelete');
    expect(media).toContain('remaining.length - 1');
    expect(media).toContain('삭제되었습니다.');
    expect(media).toContain('api.deleteEventMedia');
    expect(source('media/MediaViewer.tsx')).toContain('item.canDelete && props.onDelete');
    const finance = source('finance/FinancePanes.tsx');
    for (const text of [
      '수입·지출 수정',
      '마감된 회계연도의 거래는 수정·삭제할 수 없습니다.',
      '이 거래를 삭제할까요?',
      'api.updateTransaction',
      '.deleteTransaction(',
      'disabled={!canWrite || saving}',
    ])
      expect(finance).toContain(text);
  });
});
