import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TimelinePageQueue,
  timelineEndDirection,
} from '../../../gathering-mobile/src/features/schedule/timeline-paging';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/src/features/${path}`, import.meta.url), 'utf8');

describe('PR32 회귀', () => {
  it('부분 업로드 결과의 파일명·재시도 안내를 읽기 오류와 분리해 refresh 뒤에도 표시한다', () => {
    const pane = source('finance/FinancePanes.tsx').split('export function EventFinancePane')[1];
    const read = pane.slice(pane.indexOf('const read ='), pane.indexOf('const load ='));
    const attach = pane.slice(pane.indexOf('const attach ='), pane.indexOf('const showReceipt ='));
    expect(pane).toContain("const [receiptUploadMessage, setReceiptUploadMessage] = useState('')");
    expect(read).toContain("setMessage('')");
    expect(read).not.toContain('setReceiptUploadMessage');
    expect(attach).toContain('setReceiptUploadMessage(');
    expect(attach).toContain("${failures.join('\\n')}");
    expect(attach).toContain('실패한 파일을 다시 선택해 주세요.');
    expect(attach).toContain('if (completed) await load()');
    expect(attach).not.toContain('setMessage(error');
    expect(attach).not.toContain('setMessage(\n');
    // Both the normal ledger and a failed follow-up read must retain the batch result.
    expect(pane.match(/<Notice>\{receiptUploadMessage\}<\/Notice>/g)).toHaveLength(2);
  });

  it('예정이 더 남아 있어도 목록 끝의 지난 일정 방향을 선택한다', () => {
    expect(timelineEndDirection(50)).toBe('past');
    expect(timelineEndDirection(1)).toBe('past');
    expect(timelineEndDirection(0)).toBe('upcoming');
    const pane = source('schedule/EventsTimeline.tsx');
    expect(pane).toContain(
      'onEndReached={() => loadMore(timelineEndDirection(pages.past.items.length))}',
    );
    expect(pane).not.toContain("pages.upcoming.nextCursor ? 'upcoming' : 'past'");
    expect(pane).toContain('moreRef.current(direction)'); // upcoming boundary still loads upcoming
    expect(pane).toMatch(
      /finally\s*\{[\s\S]*?const next = pageQueue.complete\(\);\s*if \(next\) void fetchMoreRef.current\(next\)/,
    );
    expect(pane.indexOf('pagesRef.current = nextPages')).toBeLessThan(
      pane.indexOf('pageQueue.complete()'),
    );
  });

  it('예정 로딩 중 지난 일정 요청을 버리지 않고 완료 후 실행하며 중복을 병합한다', () => {
    const queue = new TimelinePageQueue();
    expect(queue.request('upcoming')).toBe('upcoming');
    expect(queue.request('past')).toBeNull();
    expect(queue.request('past')).toBeNull();
    expect(queue.request('upcoming')).toBeNull();
    expect(queue.complete()).toBe('past');
    expect(queue.complete()).toBeNull();
  });

  it('지난 일정 로딩 중 예정 섹션 경계 요청도 대기 후 실행한다', () => {
    const queue = new TimelinePageQueue();
    expect(queue.request('past')).toBe('past');
    expect(queue.request('upcoming')).toBeNull();
    expect(queue.complete()).toBe('upcoming');
    expect(queue.complete()).toBeNull();
  });

  it('전체 refresh는 옛 커서의 대기 요청만 지우고 진행 중 작업은 완료시킨다', () => {
    const queue = new TimelinePageQueue();
    expect(queue.request('upcoming')).toBe('upcoming');
    queue.request('past');
    queue.clear();
    expect(queue.complete()).toBeNull();
    expect(queue.request('past')).toBe('past');
    expect(queue.complete()).toBeNull();
  });
});
