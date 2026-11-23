import { affiliationView, type AffiliationLocal, type AffiliationRecord } from '../../jc-org/affiliation.js';
import type {
  GatheringFinanceYearView,
  GatheringGroupScope,
  GatheringGroupSummary,
  GatheringInviteView,
  GatheringMemberView,
} from '@member/contracts';
import { formatBirthDate, koreanAge } from '@member/gathering-domain';
import type { GatheringInvite, GatheringRole, GatheringSex } from '@prisma/client';

export function toInviteView(invite: GatheringInvite): GatheringInviteView {
  return {
    id: invite.id,
    expiresAt: invite.expiresAt.toISOString(),
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    requiresApproval: invite.requiresApproval,
    maxUses: invite.maxUses,
    useCount: invite.useCount,
  };
}

export function toFinanceYearView(
  year: {
    year: number;
    startsAt: Date;
    endsAt: Date;
    status: string;
    openingBalanceWon: number;
  } | null,
): GatheringFinanceYearView | null {
  if (!year) return null;
  return {
    year: year.year,
    startsAt: year.startsAt.toISOString(),
    endsAt: year.endsAt.toISOString(),
    status: year.status,
    openingBalanceWon: year.openingBalanceWon,
  };
}

export function toMemberView(member: {
  id: string;
  userId: string | null;
  manualDisplayName: string | null;
  manualLocalJcName: string | null;
  manualLocal?: AffiliationLocal | null;
  manualPhone: string | null;
  manualBirthDate?: Date | null;
  manualSex?: GatheringSex | null;
  status: string;
  user: {
    phone: string | null;
    status?: string;
    gatheringProfile: {
      displayName: string;
      birthDate?: Date | null;
      sex?: GatheringSex | null;
    } | null;
    gatheringAffiliations: AffiliationRecord[];
  } | null;
  roles: Array<{ id: string; role: GatheringRole; title: string | null }>;
}): GatheringMemberView {
  const affiliation = member.user?.gatheringAffiliations[0];
  const birth = member.userId === null ? (member.manualBirthDate ?? null) : (member.user?.gatheringProfile?.birthDate ?? null);
  const sex = member.userId === null ? (member.manualSex ?? null) : (member.user?.gatheringProfile?.sex ?? null);
  const birthDate = birth ? formatBirthDate(birth) : null;
  return {
    membershipId: member.id,
    userId: member.userId,
    isAppRegistered: member.userId !== null,
    displayName:
      member.userId === null
        ? (member.manualDisplayName ?? '이름 없음')
        : (member.user?.gatheringProfile?.displayName ??
          (member.user?.status === 'DELETED' ? '탈퇴한 회원' : '이름 없음')),
    ...(member.userId === null
      ? affiliationView(member.manualLocalJcName ?? '', member.manualLocal)
      : affiliationView(affiliation?.localJcName ?? '', affiliation?.local)),
    phone: member.userId === null ? member.manualPhone : (member.user?.phone ?? null),
    birthDate,
    age: birthDate ? koreanAge(birthDate) : null,
    sex,
    status: member.status,
    roles: member.roles.map((role) => ({ id: role.id, role: role.role, title: role.title })),
  };
}

export function hideMemberContacts(member: GatheringMemberView): GatheringMemberView {
  return { ...member, phone: null, birthDate: null, age: null, sex: null };
}

export function toGroupSummary(input: GatheringGroupScope & {
  id: string;
  name: string;
  description: string | null;
  membershipStatus: 'ACTIVE' | 'PENDING';
  roles: string[];
  presidentName: string | null;
  memberCount: number;
  financeYear: number | null;
}): GatheringGroupSummary {
  return input;
}
