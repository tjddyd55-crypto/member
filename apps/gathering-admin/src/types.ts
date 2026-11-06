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
  createdAt: string;
  creator: Person;
  president: Person | null;
  memberCount: number;
  suspended: boolean;
  subscription: { status: string; source: string | null; startsAt: string | null; expiresAt: string | null };
  usedBytes: number;
  quotaBytes: number;
  lastActivityAt: string;
};

export type MemberItem = {
  membershipId: string;
  status: string;
  group: { id: string; name: string };
  user: { id: string; name: string | null; localJcName: string | null; phone: string | null };
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
  totpReady: boolean;
  scopes: { groupId: string; capability: string }[];
};
