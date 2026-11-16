import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventDateBlock } from '../../../gathering-mobile/src/features/schedule/range';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');
const group = source('app/(app)/groups/[groupId]/index.tsx');
describe('t48 화면 구조', () => {
  it('다섯 탭은 스크롤 밖 footer에 있고 safe area 안에 놓인다', () => {
    for (const label of ['홈', '회원', '일정', '사진', '회계'])
      expect(group).toContain(`label: '${label}'`);
    expect(group).toContain('footer={');
    expect(group).not.toContain('회계연도');
    const screen = source('src/design/ui.tsx');
    expect(screen.indexOf('{footer}')).toBeGreaterThan(
      screen.indexOf('</FormScrollContext.Provider>'),
    );
    expect(screen.indexOf('{footer}')).toBeLessThan(screen.indexOf('</SafeAreaView>'));
    expect(screen).toContain("['bottom']");
  });
  it('홈은 현재 임원진과 다음 행사 하나만 표시한다', () => {
    const home = group.slice(
      group.indexOf('function HomePane'),
      group.indexOf('function MembersPane'),
    );
    for (const text of [
      'group.name',
      'group.president?.displayName',
      '임원진',
      'roleLabel(officer.role, officer.title)',
      'officer.displayName',
      ".events(group.id, new Date().toISOString(), '9999-12-31T23:59:59.999Z'",
      "order: 'asc'",
      "status: 'SCHEDULED'",
      'page.items[0]',
      '예정된 행사가 없습니다',
    ])
      expect(home).toContain(text);
    for (const text of ['내 역할', '최근 행사', '최근 사진', '재무 요약', 'api.finance'])
      expect(home).not.toContain(text);
    expect(home).not.toContain('eventsTimeline');
    expect(source('src/features/group/AppChrome.tsx')).toContain("['settings', '모임 설정']");
  });
  it.each([
    [
      '2026-11-19T10:00:00Z',
      '2026-01-01T00:00:00Z',
      { date: '11.19', year: null, time: '(목) 19:00' },
    ],
    [
      '2026-11-19T10:00:00Z',
      '2027-01-01T00:00:00Z',
      { date: '11.19', year: '2026', time: '(목) 19:00' },
    ],
    [
      '2026-12-31T15:05:00Z',
      '2026-12-31T15:00:00Z',
      { date: '01.01', year: null, time: '(금) 00:05' },
    ],
  ])('KST 날짜 블록 %s', (value, now, expected) =>
    expect(eventDateBlock(value, new Date(now))).toEqual(expected),
  );
  it('사진 목록은 갤러리 라우트를 열고 갤러리는 행사 탭을 포함하지 않는다', () => {
    const albums = source('src/features/media/AlbumsPane.tsx');
    expect(albums).toContain('/albums/event/${event.eventId}');
    for (const text of ['사진 올리기', '영상 올리기', 'setDestination', '?tab=media'])
      expect(albums).not.toContain(text);
    for (const path of [
      'app/(app)/groups/[groupId]/albums/event/[eventId].tsx',
      'app/(app)/groups/[groupId]/folders/[folderId].tsx',
      'src/features/media/AlbumGallery.tsx',
    ]) {
      for (const text of ['EVENT_TABS', 'EventDetail', 'EventFinancePane', '앨범으로'])
        expect(source(path)).not.toContain(text);
    }
    expect(source('src/features/media/AlbumGallery.tsx')).toContain('<MediaPane');
  });
  it('행사 탭은 헤더에, 큰 제목과 일시는 안내 내용 시작에 있다', () => {
    const event = source('app/(app)/groups/[groupId]/events/[eventId].tsx');
    const header = event.slice(
      event.indexOf('  const header ='),
      event.indexOf('    <Screen header={header}'),
    );
    expect(header).toContain('EVENT_TABS.map');
    expect(header).toContain('{event.title}');
    expect(header).toContain('numberOfLines={1}');
    expect(header).toContain('accessibilityLabel="뒤로"');
    expect(header).not.toContain('event.startsAt');
    const info = event.slice(
      event.indexOf("<View style={[styles.stack, tab !== 'info'"),
      event.indexOf("{visited.includes('media')}"),
    );
    expect(info.indexOf('{event.title}')).toBeGreaterThan(0);
    expect(info.indexOf('{event.title}')).toBeLessThan(info.indexOf('location.place'));
    expect(info).toContain('new Date(event.startsAt)');
  });
  it('t49 앨범은 세 버튼과 긴 누르기 선택을 사용한다', () => {
    const media = source('src/features/media/MediaPane.tsx');
    const albums = source('src/features/media/AlbumsPane.tsx');
    expect(albums).not.toContain('폴더 열기');
    expect(albums).not.toContain('앨범 열기');
    expect(albums).toContain('style={styles.card}');
    expect(media).not.toContain('앨범 새로고침');
    expect(media).not.toContain('label="선택"');
    expect(media).toContain("['사진 올리기', '영상 올리기', '업로드 링크']");
    expect(media).toContain('style={styles.uploadRow}');
    expect(media).toContain('onLongPress={onLongPress}');
    expect(media).toContain('!selecting && item.canDelete && !deleting');
    expect(media).toContain('setSelected([item.id])');
    expect(media).toContain('const selecting = selected.length > 0');
    expect(media).toContain('current.filter((id) => id !== item.id)');
    expect(media).toContain('<SelectCheckbox');
    expect(media).toContain("useInvalidatedRefresh(groupId, 'media', load, active)");
    expect(media).toContain('await load()');
    expect(source('src/features/group/AppChrome.tsx')).toContain('eventDetail ?');
  });
  it('t49 회원 행은 이름·소속·역할·전화와 작은 연락 버튼, 차단 메뉴를 유지한다', () => {
    expect(group).toContain('style={styles.memberRow}');
    expect(group).toContain('member.localJcName, visibleRoleLabels(member.roles)');
    expect(group).toContain('<Text style={styles.memberMeta}>{member.phone}</Text>');
    expect(group).toContain("['전화', '문자']");
    expect(group).toContain("'tel' : 'sms'");
    expect(group).toContain('setMemberMenu(member)');
    expect(group).toContain('⋯');
    expect(group).toContain('<Modal transparent visible');
    expect(group).toContain('label="차단"');
    expect(group).toContain('void block(userId)');
  });
});
