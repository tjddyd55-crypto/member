import type {
  GatheringFinanceYearView,
  GatheringGroupDetail,
  GatheringGroupSummary,
  GatheringInviteView,
  GatheringMemberView,
} from '@member/contracts';
import type { GatheringInvite, GatheringRole } from '@prisma/client';

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
  manualPhone: string | null;
  status: string;
  user: {
    phone: string | null;
    status?: string;
    gatheringProfile: { displayName: string } | null;
    gatheringAffiliations: Array<{ localJcName: string }>;
  } | null;
  roles: Array<{ id: string; role: GatheringRole; title: string | null }>;
}): GatheringMemberView {
  return {
    membershipId: member.id,
    userId: member.userId,
    isAppRegistered: member.userId !== null,
    displayName:
      member.user?.gatheringProfile?.displayName ??
      member.manualDisplayName ??
      (member.user?.status === 'DELETED' ? '탈퇴한 회원' : '이름 없음'),
    localJcName: member.user?.gatheringAffiliations[0]?.localJcName ?? member.manualLocalJcName ?? '',
    phone: member.user ? member.user.phone : member.manualPhone,
    status: member.status,
    roles: member.roles.map((role) => ({ id: role.id, role: role.role, title: role.title })),
  };
}

export function toGroupSummary(input: {
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
