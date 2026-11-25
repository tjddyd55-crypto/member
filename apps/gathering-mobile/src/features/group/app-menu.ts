export const GATHERING_TABS = ['홈', '회원', '일정', '사진', '회계'] as const;

export const GLOBAL_MENU_ROUTES = [
  { id: 'groups', label: '내 모임', href: '/(app)/groups' },
  { id: 'calendar', label: '전체 일정', href: '/(app)/calendar' },
] as const;

export type GatheringSwitchTarget = {
  id: string;
  name: string;
  membershipStatus: 'ACTIVE' | 'PENDING';
};

export function visibleGroupName(
  cached: { id: string; name: string } | null | undefined,
  currentId?: string,
) {
  if (!cached || !currentId || cached.id !== currentId) return null;
  const name = cached.name.trim();
  return name || null;
}

export function compactHeaderTitle(input: { groupName?: string | null; routeTitle: string }) {
  const name = input.groupName?.trim();
  if (name) return name;
  return input.routeTitle;
}

export function routeHeaderTitle(pathname: string) {
  if (pathname.includes('/calendar')) return '전체 일정';
  if (pathname.includes('/profile')) return '내 정보';
  if (pathname.includes('/account-delete')) return '계정 삭제';
  if (pathname.includes('/groups/create')) return '모임 만들기';
  if (/\/groups\/[^/]+/.test(pathname)) return '모임';
  if (pathname.includes('/groups')) return '내 모임';
  return 'JCI KOREA';
}

/** 메뉴 이동은 한 번의 내비게이션으로 이전 모임을 스택에 남기지 않는다. */
export function globalMenuNavigation() {
  return 'reset' as const;
}

/**
 * 경로 상태는 루트 내비게이터 모양이다. 포커스된 화면에 그대로 리셋하면
 * 루트 경로가 거절되고 이동이 무시된다. 루트가 받을 수 있을 때만 그 키를 돌려준다.
 */
export function rootResetTarget(
  root: { key?: string; routeNames?: readonly string[] } | null | undefined,
  state:
    | {
        stale?: boolean;
        routeNames?: readonly string[];
        routes?: readonly { name?: string }[];
      }
    | null
    | undefined,
) {
  const target = root?.key;
  const names = root?.routeNames;
  const routes = state?.routes;
  if (!target || !names?.length || !routes?.length) return null;
  if (!routes.every((route) => typeof route.name === 'string' && names.includes(route.name))) return null;
  if (state?.stale === false && state.routeNames) {
    const nextNames = state.routeNames;
    if (nextNames.length !== names.length || nextNames.some((name) => !names.includes(name))) return null;
  }
  return target;
}

export function gatheringSwitchItems(groups: readonly GatheringSwitchTarget[], currentId?: string) {
  return groups
    .filter((group) => group.membershipStatus === 'ACTIVE')
    .map((group) => ({
      id: group.id,
      label: group.name,
      href: `/(app)/groups/${group.id}`,
      selected: group.id === currentId,
    }));
}

export type DrawerItem = {
  id: string;
  label: string;
  href: string;
  icon?: 'settings-outline' | 'shield-checkmark-outline' | 'people-outline' | 'swap-horizontal-outline' | 'calendar-outline' | 'add-outline' | 'albums-outline' | 'folder-outline';
  selected?: boolean;
};

export type DrawerGroup = { id: string; name: string; permissions: readonly string[] };
export type HandoverActions = { nominate: boolean; accept: boolean; confirm: boolean; finalize: boolean; cancel: boolean };

/** Uses the same grants as settings/manage and the entry checks in officers. */
export function groupMenuItems(group: DrawerGroup | null, actions?: HandoverActions | null): DrawerItem[] {
  if (!group) return [];
  const has = (permission: string) => group.permissions.includes(permission);
  const base = `/(app)/groups/${group.id}`;
  const items: DrawerItem[] = [{ id: 'documents', label: '자료실', href: `${base}/documents`, icon: 'folder-outline' }];
  if (has('GROUP_SETTINGS')) items.push({ id: 'settings', label: '모임 설정', href: `${base}/settings`, icon: 'settings-outline' });
  if (['GROUP_SETTINGS', 'INVITE_MANAGE', 'MEMBER_MANAGE'].some(has)) items.push({ id: 'manage', label: '관리', href: `${base}/manage`, icon: 'shield-checkmark-outline' });
  if (has('MEMBER_READ')) items.push({ id: 'officers', label: '집행부', href: `${base}/officers`, icon: 'people-outline' });
  if (has('HANDOVER') || (actions && Object.values(actions).some(Boolean))) items.push({ id: 'handover', label: '차기 협의회장 인계', href: `${base}/handover`, icon: 'swap-horizontal-outline' });
  return items;
}

export function drawerSections(groups: readonly GatheringSwitchTarget[], currentId?: string, group: DrawerGroup | null = null, actions?: HandoverActions | null) {
  const sections: { id: string; title: string; items: DrawerItem[] }[] = [
    { id: 'groups', title: '내 모임', items: [
      ...gatheringSwitchItems(groups, currentId),
      { id: 'all-groups', label: '모든 모임 보기', href: '/(app)/groups', icon: 'albums-outline' },
      { id: 'create', label: '모임 만들기', href: '/(app)/groups/create', icon: 'add-outline' },
    ] },
  ];
  if (currentId && group?.id === currentId) sections.push({ id: 'current', title: group.name, items: groupMenuItems(group, actions) });
  sections.push({ id: 'global', title: '전체', items: GLOBAL_MENU_ROUTES.filter((item) => item.id !== 'groups').map((item) => ({ ...item, icon: 'calendar-outline' })) });
  return sections;
}
