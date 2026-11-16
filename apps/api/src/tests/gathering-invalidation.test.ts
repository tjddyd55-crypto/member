import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  dataVersion,
  invalidate,
  invalidateMutation,
  subscribeInvalidation,
} from '../../../gathering-mobile/src/state/invalidation';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');

describe('모임 데이터 무효화', () => {
  it('그룹·종류별 버전과 구독 해제를 분리한다', () => {
    let calls = 0;
    const unsubscribe = subscribeInvalidation(() => calls++);
    invalidate('unit-a', 'media');
    expect(dataVersion('unit-a', 'media')).toBe(1);
    expect(dataVersion('unit-a', 'finance')).toBe(0);
    expect(dataVersion('unit-b', 'media')).toBe(0);
    expect(calls).toBe(1);
    unsubscribe();
    invalidate('unit-a', 'media');
    expect(calls).toBe(1);
  });
  it.each([
    ['events', 'POST', 'schedule'], ['events/e', 'PATCH', 'schedule'], ['events/e', 'DELETE', 'schedule'],
    ['events/e/attendance', 'PUT', 'schedule'],
    ['folders', 'POST', 'media'],
    ['folders/f', 'POST', 'media'],
    ['folders/f', 'DELETE', 'media'],
    ['media/m', 'DELETE', 'media'],
    ['events/e/media/delete', 'POST', 'media'],
    ['events/e/media/m/complete', 'POST', 'media'],
    ['folders/f/media/m/complete', 'POST', 'media'],
    ['transactions/t', 'PUT', 'finance'],
    ['transactions/t', 'DELETE', 'finance'],
    ['events/e/transactions', 'POST', 'finance'],
    ['finance/dues', 'POST', 'finance'],
    ['events/e/receipts/r/complete', 'POST', 'finance'],
  ] as const)('%s %s 성공 경로', (resource, method, kind) => {
    const before = dataVersion('paths', kind);
    invalidateMutation(`/api/gathering/groups/paths/${resource}`, method);
    expect(dataVersion('paths', kind)).toBe(before + 1);
  });
  it('조회·업로드 예약은 무효화하지 않는다', () => {
    const before = dataVersion('paths', 'media');
    invalidateMutation('/api/gathering/groups/paths/folders', 'GET');
    invalidateMutation('/api/gathering/groups/paths/events/e/media/uploads', 'POST');
    expect(dataVersion('paths', 'media')).toBe(before);
    const client = source('src/api/client.ts');
    expect(client.indexOf('invalidateMutation(path,')).toBeGreaterThan(
      client.indexOf('if (!response.ok)'),
    );
    expect(client).toContain("init.body != null ? { 'Content-Type': 'application/json' } : {}");
  });
  it('각 Pane은 공용 구독·포커스 재조회를 사용하고 조회 시 오류를 지운다', () => {
    for (const file of [
      'media/AlbumsPane.tsx',
      'media/MediaPane.tsx',
      'finance/FinancePanes.tsx',
    ]) {
      const pane = source(`src/features/${file}`);
      expect(pane).toContain('useInvalidatedRefresh(groupId,');
      expect(pane).toContain("setMessage('');");
      expect(pane).toContain('useRefreshLoad(read)');
    }
    const albums = source('src/features/media/AlbumsPane.tsx');
    expect(albums).toContain('setFolderError(null)');
    expect(albums).toContain("setRenameError('')");
    const hook = source('src/state/useInvalidatedRefresh.ts');
    expect(hook).toContain('useSyncExternalStore(subscribeInvalidation');
    expect(hook).toMatch(/useFocusEffect\(\s*useCallback/);
    expect(hook).toContain('if (!active) return');
    expect(hook).toContain('clearTimeout(timer)');
    const events = albums.slice(
      albums.indexOf('{events.map('),
      albums.indexOf('async function renameFolder'),
    );
    expect(events).not.toContain('행사 앨범은 일정에서 관리됩니다');
    expect(events).not.toContain('⋯');
    expect(events).not.toContain('confirmDeleteFolder');
    expect(albums).toContain('folder.canManage ?');
    expect(source('app/(app)/groups/[groupId]/index.tsx')).toContain(
      "useInvalidatedRefresh(group.id, 'all', refreshHome)",
    );
  });
});
