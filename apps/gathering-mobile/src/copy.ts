export { APP_DISPLAY_NAME as APP_NAME } from '../app-identity';

export const DISCLAIMER =
  '이 이름은 모임 앱을 구분하기 위한 표시입니다. 특정 단체의 공식 승인이나 제휴를 뜻하지 않습니다.';

export const IDENTITY_LIMITATION =
  '휴대폰 문자 인증을 하지 않습니다. 비밀번호와 가입 때 한 번 보여 주는 복구 코드로만 로그인하고 복구할 수 있습니다. 복구 코드를 잃어버리면 이 앱은 같은 사람인지 확인하지 못합니다.';

export const DIRECTORY_CONSENT =
  '모임에 참여하면 이름, 소속 로컬, 휴대폰 번호가 그 모임 구성원에게 보이고 전화와 문자로 연결될 수 있습니다.';

export const ROLE_LABEL: Record<string, string> = {
  PRESIDENT: '협의회장',
  SECRETARY: '총무',
  TREASURER: '재무',
  EXECUTIVE: '집행부',
  MEMBER: '일반 회원',
};

export function roleLabel(role: string, title?: string | null) {
  if (title && title.trim()) return title.trim();
  return ROLE_LABEL[role] ?? '일반 회원';
}

export function visibleRoleLabels(roles: ReadonlyArray<string | { role: string; title?: string | null }>) {
  const normalized = roles.map((role) => (typeof role === 'string' ? { role, title: null } : role));
  const offices = normalized.filter((role) => role.role !== 'MEMBER');
  const shown = offices.length > 0 ? offices : normalized;
  if (shown.length === 0) return '일반 회원';
  return shown.map((role) => roleLabel(role.role, role.title)).join(', ');
}
