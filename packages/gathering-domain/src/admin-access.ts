export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_CAPABILITIES = [
  'GROUP_READ',
  'MEMBER_READ',
  'CONTACT_READ',
  'AUDIT_READ',
  'SUBSCRIPTION_WRITE',
  'PAYMENT_WRITE',
  'QUOTA_WRITE',
  'MEMBER_RESTRICT',
  'SETTINGS',
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export const ADMIN_LOCK_THRESHOLD = 5;
export const ADMIN_LOCK_MS = 15 * 60 * 1000;
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const ADMIN_ENROLLMENT_MS = 10 * 60 * 1000;
export const ADMIN_PASSWORD_MIN = 12;

export type AdminScope = { groupId: string; capability: string };

export function isAdminCapability(value: string): value is AdminCapability {
  return (ADMIN_CAPABILITIES as readonly string[]).includes(value);
}

export function adminLockUntil(failedAttempts: number, now: Date) {
  if (failedAttempts < ADMIN_LOCK_THRESHOLD) return null;
  return new Date(now.getTime() + ADMIN_LOCK_MS);
}

export function adminLoginBlocked(lockedUntil: Date | null, now: Date) {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}

export function sessionExpiry(now: Date) {
  return new Date(now.getTime() + ADMIN_SESSION_MS);
}

/** 슈퍼관리자는 전 모임이다. 일반 관리자는 부여된 모임과 능력만 된다. */
export function adminAllows(input: {
  role: AdminRole;
  disabled: boolean;
  scopes: readonly AdminScope[];
  capability: AdminCapability;
  groupId?: string;
}) {
  if (input.disabled) return false;
  if (input.role === 'SUPER_ADMIN') return true;
  return input.scopes.some(
    (scope) => scope.capability === input.capability && (input.groupId == null || scope.groupId === input.groupId),
  );
}

export function canManageAdminAccounts(role: AdminRole, disabled: boolean) {
  return role === 'SUPER_ADMIN' && !disabled;
}
