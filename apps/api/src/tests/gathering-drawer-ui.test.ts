import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { permissionsForRoles, type GatheringRole } from '@member/gathering-domain';
import { drawerSections, groupMenuItems, type HandoverActions } from '../../../gathering-mobile/src/features/group/app-menu';

const group = (roles: GatheringRole[]) => ({ id: 'a', name: '현재 모임', permissions: permissionsForRoles(roles) });
const ids = (roles: GatheringRole[]) => groupMenuItems(group(roles)).map((item) => item.id);
describe('drawer sections and permission gates', () => {
  it('hides group entries until loaded and separates global routes', () => {
    expect(groupMenuItems(null)).toEqual([]);
    expect(drawerSections([], 'a').map((s) => s.title)).toEqual(['내 모임', '전체']);
    const sections = drawerSections([{ id: 'a', name: '현재 모임', membershipStatus: 'ACTIVE' }], 'a', group(['MEMBER']));
    expect(sections.map((s) => s.title)).toEqual(['내 모임', '현재 모임', '전체']);
    expect(sections[0].items[0].selected).toBe(true);
    expect(sections[0].items.slice(1)).toEqual([
      { id: 'all-groups', label: '모든 모임 보기', href: '/(app)/groups', icon: 'albums-outline' },
      { id: 'create', label: '모임 만들기', href: '/(app)/groups/create', icon: 'add-outline' },
    ]);
    expect(sections[2].items.map((i) => i.label)).toEqual(['전체 일정']);
    expect(drawerSections([], 'b', group(['PRESIDENT']))).toHaveLength(2);
  });
  it.each(['MEMBER', 'EXECUTIVE', 'TREASURER'] as GatheringRole[])('%s can view officers only', (role) => {
    expect(ids([role])).toEqual(['officers']);
  });
  it('uses the settings and management screen grants', () => {
    expect(ids(['SECRETARY'])).toEqual(['manage', 'officers']);
    expect(ids(['PRESIDENT'])).toEqual(['settings', 'manage', 'officers', 'handover']);
    for (const permission of ['GROUP_SETTINGS', 'INVITE_MANAGE', 'MEMBER_MANAGE']) {
      expect(groupMenuItems({ id: 'a', name: '모임', permissions: [permission] }).map((i) => i.id)).toContain('manage');
    }
    expect(groupMenuItems({ id: 'a', name: '모임', permissions: [] })).toEqual([]);
  });
  it('allows handover participants using server actions', () => {
    const none: HandoverActions = { nominate: false, accept: false, confirm: false, finalize: false, cancel: false };
    expect(groupMenuItems(group(['MEMBER']), none).map((i) => i.id)).not.toContain('handover');
    for (const action of Object.keys(none)) {
      expect(groupMenuItems(group(['MEMBER']), { ...none, [action]: true }).map((i) => i.id)).toContain('handover');
    }
  });
  it('renders an icon close button and section headings with gated items', () => {
    const ui = readFileSync(new URL('../../../gathering-mobile/src/features/group/AppChrome.tsx', import.meta.url), 'utf8');
    expect(ui).not.toContain('보는 중');
    expect(ui).not.toMatch(/>닫기</);
    expect(ui).toContain('Ionicons name="close"');
    expect(ui).toContain('accessibilityLabel="메뉴 닫기"');
    expect(ui).toContain('drawerSections(groups, groupId, menuGroup, handoverActions)');
    expect(ui).toContain('accessibilityRole="header"');
    expect(ui).toContain('{section.title}');
    expect(ui).toContain('styles.divider');
    expect(ui).toContain('api.handover(groupId)');
  });
});
