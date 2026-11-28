export type Admin = { id: string; loginId: string; role: 'SUPER_ADMIN' | 'ADMIN' };

export type Person = {
  id: string;
  name: string | null;
  phone: string | null;
  localJcName: string | null;
  since: string;
};

export type GroupItem = {
  id: string;
  name: string;
  scopeDistrictId: string | null;
  scopeLocalId: string | null;
  createdAt: string;
  creator: Person;
  president: Person | null;
  memberCount: number;
  canManageMembers?: boolean;
  suspended: boolean;
  subscription: { id: string | null; status: string; source: string | null; startsAt: string | null; expiresAt: string | null };
  usedBytes: number;
  quotaBytes: number;
  lastActivityAt: string;
};

export type MemberItem = {
  membershipId: string;
  status: string;
  group: { id: string; name: string };
  isAppRegistered: boolean;
  linkCandidate: { membershipId: string; displayName: string; localJcName: string; phone: string | null } | null;
  user: {
    id: string | null;
    name: string | null;
    localJcName: string | null;
    localId: string | null;
    district: Pick<JcChoice, 'id' | 'displayName'> | null;
    localDisplayName: string;
    affiliationNeedsReselect: boolean;
    phone: string | null;
    birthDate: string | null;
    age: number | null;
    sex: 'MALE' | 'FEMALE' | null;
  };
};

export type AuditItem = {
  id: string;
  action: string;
  actor: { id: string; loginId: string; role: string } | null;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminAccount = {
  id: string;
  loginId: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
  disabledAt: string | null;
  scopes: { groupId: string; capability: string }[];
};

export type JcChoice = { id: string; name: string; displayName: string };

export type JcVerification = 'CONFIRMED' | 'NEEDS_REVIEW';

export type JcOrg = JcChoice & {
  isActive: boolean;
  verificationState: JcVerification;
  reviewReason: string | null;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
  adminNote: string | null;
  registryKey: string | null;
};

export type JcDistrict = JcOrg & {
  activeLocalCount: number;
  totalLocalCount: number;
  needsReviewCount: number;
};

export type JcLocal = JcOrg & {
  districtId: string;
  approvalNumber: string | null;
  serviceEnabled: boolean;
  serviceEnabledAt: string | null;
  hasOwner: boolean;
};

export type JcReview = (JcDistrict & { orgType: 'DISTRICT' }) | (JcLocal & { orgType: 'LOCAL' });

export type JcOrgHistory = {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actorLabel: string | null;
  actorAdmin: { loginId: string } | null;
  note: string | null;
  createdAt: string;
};
