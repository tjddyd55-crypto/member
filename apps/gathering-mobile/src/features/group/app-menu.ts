export const GATHERING_TABS = ['홈', '회원', '일정', '사진', '재무'] as const;

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
  if (pathname.includes('/profile')) return '모임 프로필';
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
