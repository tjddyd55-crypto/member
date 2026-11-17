import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatAlbumDate,
  formatEventDateTime,
} from '../../../gathering-mobile/src/features/schedule/range';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');

describe('앨범·선택·연속 일정 UI', () => {
  it('행사와 폴더는 같은 카드와 제목·개수 구조를 쓰고 배지와 관리 메뉴만 다르다', () => {
    const albums = source('src/features/media/AlbumsPane.tsx');
    expect(albums).toContain('styles.eventBadge]}>행사');
    expect(albums).toContain('styles.folderBadge]}>폴더');
    expect(albums).not.toContain('formatAlbumDate(event.startsAt)');
    expect(albums.match(/style=\{styles.card\}/g)).toHaveLength(2);
    expect(albums.match(/style=\{styles.heading\}/g)).toHaveLength(2);
    expect(albums).toContain('{albumCardDate(folder.createdAt)} · 사진 {folder.photoCount}');
    expect(albums).toContain('{folder.videoCount}');
    expect(albums).toContain('사진 {event.photoCount} · 영상 {event.videoCount}');
    expect(albums).toContain('theme.colors.primary.soft');
    expect(albums).toContain('theme.colors.bg.default');
    const events = albums.slice(
      albums.indexOf('{events.map('),
      albums.indexOf('async function renameFolder'),
    );
    expect(events).not.toContain('⋯');
    expect(events).not.toContain('confirmDeleteFolder');
    expect(albums).toContain('folder.canManage ?');
  });
  it('공용 흰색 사각 체크박스와 권한 없는 타일의 비활성 상태를 사용한다', () => {
    const checkbox = source('src/design/SelectCheckbox.tsx');
    for (const pattern of [
      'width: 24',
      'height: 24',
      'borderRadius: 4',
      'top: 6',
      'right: 6',
      "borderColor: '#FFFFFF'",
      "backgroundColor: '#FFFFFF'",
      'shadowColor:',
      'elevation:',
      'name="checkmark"',
      'theme.colors.text.primary',
      'pointerEvents="none"',
    ])
      expect(checkbox).toContain(pattern);
    const media = source('src/features/media/MediaPane.tsx');
    expect(media).toContain('<SelectCheckbox selected={Boolean(selected)} size={20} />');
    expect(media).toContain('selecting && item.canDelete ?');
    expect(media).toContain('selecting && !item.canDelete && { opacity: 0.35 }');
    expect(media).not.toContain("selected ? '✓' : '○'");
    expect(media).toContain(
      'else for (const asset of assets) await api.deleteMedia(groupId, asset.id)',
    );
  });
  it('사진 화면에서 안내 문장을 제거하고 빈 상태·오류·진행 상태를 유지한다', () => {
    const paths = [
      'src/features/media/AlbumsPane.tsx',
      'src/features/media/MediaPane.tsx',
      'src/features/media/MediaViewer.tsx',
      'src/features/media/UploadLinkPanel.tsx',
      'src/features/media/upload-block.ts',
      'app/(app)/groups/[groupId]/folders/[folderId].tsx',
    ];
    const combined = paths.map(source).join('\n');
    for (const removed of [
      '행사 앨범은 일정에서 관리됩니다',
      '아래에서 행사나 폴더를 고르세요.',
      '올리는 곳: ${destination.title}',
      '행사나 폴더를 만든 뒤 사진과 영상을 올릴 수 있습니다.',
      '사진 올리기나 영상 올리기로 이 폴더에 바로 넣을 수 있습니다.',
      '사진이나 영상을 올릴 행사 또는 폴더를 고르세요.',
      '올릴 행사나 폴더가 없습니다. 행사를 만들거나 폴더를 만든 뒤 올리세요.',
      '이미 올린 자료는 볼 수 있습니다.',
      '이 링크는 이 ',
      '에만 사진과 영상을 올립니다. 주소는 만들 때',
      '한 번만 보입니다.',
      '이 주소는 지금만 전체 표시됩니다. 복사하거나 공유해 두세요.',
    ])
      expect(combined).not.toContain(removed);
    expect(combined).toContain('등록된 사진이 없습니다');
    expect(combined).toContain('사진·영상을 불러오지 못했습니다.');
    expect(combined).toContain('전송 {progress.loaded}/{progress.total}');
  });
  it('그룹 및 전체 일정에 월 이동 없이 같은 자동 페이징 목록을 표시한다', () => {
    const events = source('src/features/schedule/EventsPane.tsx');
    const calendar = source('app/(app)/calendar.tsx');
    for (const file of [events, calendar]) {
      expect(file).toContain('<EventsTimeline');
      for (const old of ['monthRange', 'shiftMonth', '이전달', '다음달', '이 달의'])
        expect(file).not.toContain(old);
    }
    const timeline = source('src/features/schedule/EventsTimeline.tsx');
    for (const text of [
      'SectionList',
      "key: 'upcoming'",
      '지난 일정',
      'onEndReached=',
      'onViewableItemsChanged=',
      "useInvalidatedRefresh(groupId ?? '*', 'schedule', load)",
      '등록된 일정이 없습니다',
      'eventDateBlock(item.startsAt)',
    ])
      expect(timeline).toContain(text);
    expect(timeline).not.toContain('더 보기');
    expect(calendar).toContain('<Screen scroll={false}>');
    expect(source('app/(app)/groups/[groupId]/index.tsx')).toContain("scroll={tab !== 'schedule'}");
    expect(events).toContain('canManage ?');
    expect(events).toContain('행사 만들기');
  });
  it('일정 변경 신호는 그룹 일정과 전체 일정에 전달하고 업로드 신호와 분리한다', () => {
    const state = source('src/state/invalidation.ts');
    expect(state).toContain("invalidate(groupId, 'schedule')");
    expect(state).toContain("versions.set('*:schedule'");
    const service = readFileSync(new URL('../modules/gathering/events/service.ts', import.meta.url), 'utf8');
    const sharedRead = service.slice(service.indexOf('async function listScopedEvents'), service.indexOf('export async function listMyEvents'));
    expect(sharedRead.match(/gatheringEvent.findMany/g)).toHaveLength(1);
    expect(sharedRead).toContain('include: eventInclude');
    expect(sharedRead).not.toContain('Promise.all');
  });
  it('앨범 날짜는 KST 날짜와 요일을 표시한다', () => {
    expect(formatAlbumDate('2026-11-11T15:00:00.000Z')).toBe('2026. 11. 12. (목)');
  });
  it.each([
    ['2026-11-19T10:00:00.000Z', '2026-01-01T00:00:00Z', '11.19 (목) 19:00'],
    ['2026-11-19T10:00:00.000Z', '2027-01-01T00:00:00Z', '2026.11.19 (목) 19:00'],
    ['2026-12-31T15:05:00.000Z', '2026-12-31T15:00:00Z', '01.01 (금) 00:05'],
    ['2026-12-31T14:59:00.000Z', '2026-12-31T15:00:00Z', '2026.12.31 (목) 23:59'],
  ])('일정 날짜 %s / 현재 %s', (value, now, expected) => {
    expect(formatEventDateTime(value, new Date(now))).toBe(expected);
  });
});
