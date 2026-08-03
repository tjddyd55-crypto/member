import type { MembershipRole, PrivacyVisibility } from '@prisma/client';
import { isAdminRole } from '@member/shared';

const SENSITIVE_FIELDS = [
  'phone',
  'email',
  'birthDate',
  'homeAddress',
  'spouseName',
  'companyName',
  'companyPosition',
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

export function canViewField(
  visibility: PrivacyVisibility | undefined,
  viewerRole: MembershipRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return true;
  const v = visibility ?? 'MEMBERS';
  if (v === 'PRIVATE') return false;
  if (v === 'ADMINS') return isAdminRole(viewerRole);
  return true;
}

export function applyPrivacy<T extends Record<string, unknown>>(
  data: T,
  privacyMap: Record<string, PrivacyVisibility>,
  viewerRole: MembershipRole,
  isSelf: boolean,
): T {
  const next = { ...data };
  for (const field of SENSITIVE_FIELDS) {
    if (!(field in next)) continue;
    const visibility = privacyMap[field];
    if (!canViewField(visibility, viewerRole, isSelf)) {
      (next as Record<string, unknown>)[field] = null;
    }
  }
  return next;
}
