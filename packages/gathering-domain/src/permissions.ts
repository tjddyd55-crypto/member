export const GATHERING_ROLES = [
  'PRESIDENT',
  'SECRETARY',
  'TREASURER',
  'EXECUTIVE',
  'MEMBER',
] as const;

export type GatheringRole = (typeof GATHERING_ROLES)[number];

export const GATHERING_PERMISSIONS = [
  'GROUP_SETTINGS',
  'ROLE_ASSIGN',
  'HANDOVER',
  'MEMBER_MANAGE',
  'EVENT_MANAGE',
  'FINANCE_WRITE',
  'RECEIPT_WRITE',
  'MEMBER_READ',
  'EVENT_READ',
  'FINANCE_READ',
  'MEDIA_UPLOAD',
  'MEDIA_MODERATE',
  'INVITE_MANAGE',
] as const;

export type GatheringPermission = (typeof GATHERING_PERMISSIONS)[number];

const ALL_PERMISSIONS: readonly GatheringPermission[] = GATHERING_PERMISSIONS;

const MEMBER_READS: readonly GatheringPermission[] = [
  'MEMBER_READ',
  'EVENT_READ',
  'FINANCE_READ',
  'MEDIA_UPLOAD',
];

/**
 * 추가 집행부(EXECUTIVE)는 명부에 직함으로 남고, 데이터 권한은 일반 회원과 같다.
 * 직함별 세부 권한은 나중에 역할 정의 테이블로 확장한다. 지금은 하드코딩하지 않는다.
 */
const ROLE_PERMISSIONS: Record<GatheringRole, readonly GatheringPermission[]> = {
  PRESIDENT: ALL_PERMISSIONS,
  SECRETARY: ['MEMBER_MANAGE', 'EVENT_MANAGE', 'INVITE_MANAGE', 'MEDIA_MODERATE', ...MEMBER_READS],
  TREASURER: ['FINANCE_WRITE', 'RECEIPT_WRITE', ...MEMBER_READS],
  EXECUTIVE: MEMBER_READS,
  MEMBER: MEMBER_READS,
};

export function isGatheringRole(value: string): value is GatheringRole {
  return (GATHERING_ROLES as readonly string[]).includes(value);
}

export function permissionsForRoles(roles: readonly GatheringRole[]): GatheringPermission[] {
  const granted = new Set<GatheringPermission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }
  return GATHERING_PERMISSIONS.filter((permission) => granted.has(permission));
}

export function hasPermission(
  roles: readonly GatheringRole[],
  permission: GatheringPermission,
): boolean {
  return permissionsForRoles(roles).includes(permission);
}
