import type { GatheringGroupDetail } from '@member/contracts';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { blockedUserIds } from './moderation/blocks.js';
import { toFinanceYearView, toGroupSummary, toMemberView } from './presenters/group.js';

export const memberInclude = {
  user: {
    include: {
      gatheringProfile: true,
      gatheringAffiliations: { where: { isCurrent: true }, take: 1 },
    },
  },
  roles: { where: { revokedAt: null } },
} as const;

export async function listMyGroups(userId: string, query?: string) {
  const memberships = await prisma.gatheringMembership.findMany({
    where: {
      userId,
      status: { in: ['ACTIVE', 'PENDING'] },
      group: query ? { name: { contains: query, mode: 'insensitive' } } : undefined,
    },
    include: { roles: { where: { revokedAt: null } } },
    orderBy: { createdAt: 'desc' },
  });
  const groupIds = memberships.map((membership) => membership.groupId);
  const context = await loadListContext(groupIds);
  return memberships.map((membership) =>
    toGroupSummary({
      id: membership.groupId,
      name: context.names.get(membership.groupId) ?? '',
      description: context.descriptions.get(membership.groupId) ?? null,
      membershipStatus: membership.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
      roles: membership.roles.map((role) => role.role),
      presidentName: context.presidents.get(membership.groupId) ?? null,
      memberCount: context.counts.get(membership.groupId) ?? 0,
      financeYear: context.years.get(membership.groupId) ?? null,
    }),
  );
}

async function loadListContext(groupIds: string[]) {
  if (groupIds.length === 0) {
    return emptyListContext();
  }
  const [groups, presidents, counts, years] = await Promise.all([
    prisma.gatheringGroup.findMany({ where: { id: { in: groupIds } } }),
    prisma.gatheringRoleAssignment.findMany({
      where: { groupId: { in: groupIds }, role: 'PRESIDENT', revokedAt: null },
      include: { user: { include: { gatheringProfile: true } } },
    }),
    prisma.gatheringMembership.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds }, status: 'ACTIVE' },
      _count: { _all: true },
    }),
    prisma.gatheringFinanceYear.findMany({
      where: { groupId: { in: groupIds }, status: 'OPEN' },
      orderBy: { year: 'desc' },
    }),
  ]);
  return {
    names: new Map(groups.map((group) => [group.id, group.name])),
    descriptions: new Map(groups.map((group) => [group.id, group.description])),
    presidents: new Map(
      presidents.map((row) => [row.groupId, row.user?.gatheringProfile?.displayName ?? null]),
    ),
    counts: new Map(counts.map((row) => [row.groupId, row._count._all])),
    years: firstOpenYear(years),
  };
}

function firstOpenYear(rows: Array<{ groupId: string; year: number }>) {
  const years = new Map<string, number>();
  for (const row of rows) {
    if (!years.has(row.groupId)) years.set(row.groupId, row.year);
  }
  return years;
}

function emptyListContext() {
  return {
    names: new Map<string, string>(),
    descriptions: new Map<string, string | null>(),
    presidents: new Map<string, string | null>(),
    counts: new Map<string, number>(),
    years: new Map<string, number>(),
  };
}

export async function getGroupDetail(
  userId: string,
  groupId: string,
): Promise<GatheringGroupDetail> {
  const access = await requireGroupMember(userId, groupId, 'read');
  const group = await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: groupId } });
  const [president, memberCount, financeYear, pendingCount] = await Promise.all([
    findPresident(groupId),
    prisma.gatheringMembership.count({ where: { groupId, status: 'ACTIVE' } }),
    prisma.gatheringFinanceYear.findFirst({
      where: { groupId, status: 'OPEN' },
      orderBy: { year: 'desc' },
    }),
    access.permissions.includes('MEMBER_MANAGE')
      ? prisma.gatheringMembership.count({ where: { groupId, status: 'PENDING' } })
      : Promise.resolve(null),
  ]);
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    inviteRequiresApproval: group.inviteRequiresApproval,
    fiscalStartMonth: group.fiscalStartMonth,
    fiscalStartDay: group.fiscalStartDay,
    roles: access.roles,
    permissions: access.permissions,
    president,
    memberCount,
    financeYear: toFinanceYearView(financeYear),
    pendingCount,
  };
}

async function findPresident(groupId: string) {
  const assignment = await prisma.gatheringRoleAssignment.findFirst({
    where: { groupId, role: 'PRESIDENT', revokedAt: null },
    include: {
      user: {
        include: {
          gatheringProfile: true,
          gatheringAffiliations: { where: { isCurrent: true }, take: 1 },
        },
      },
    },
  });
  if (!assignment?.userId || !assignment.user) return null;
  return {
    userId: assignment.userId,
    displayName: assignment.user.gatheringProfile?.displayName ?? '이름 없음',
    localJcName: assignment.user.gatheringAffiliations[0]?.localJcName ?? '',
  };
}

export async function listGroupMembers(
  userId: string,
  groupId: string,
  query?: string,
  status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
) {
  const access = await requireGroupMember(userId, groupId, 'read');
  assertPermission(access, status === 'PENDING' ? 'MEMBER_MANAGE' : 'MEMBER_READ');
  const members = await prisma.gatheringMembership.findMany({
    where: {
      groupId,
      status,
      ...(query ? memberSearch(query) : {}),
    },
    include: memberInclude,
  });
  const candidates = await manualLinkCandidates(members);
  const hidden = status === 'ACTIVE' ? await blockedUserIds(groupId, userId) : new Set<string>();
  return members
    .map((member) => {
      const view = toMemberView(member);
      if (status === 'PENDING') view.linkCandidate = candidateFor(candidates, member);
      if (!member.userId || !hidden.has(member.userId)) return view;
      return { ...view, phone: null };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ko'));
}

export function memberSearch(query: string, phoneGroupIds?: string[] | null) {
  return {
    OR: [
      {
        user: {
          gatheringProfile: {
            is: { displayName: { contains: query, mode: 'insensitive' as const } },
          },
        },
      },
      {
        user: {
          gatheringAffiliations: {
            some: {
              isCurrent: true,
              localJcName: { contains: query, mode: 'insensitive' as const },
            },
          },
        },
      },
      { userId: null, manualDisplayName: { contains: query, mode: 'insensitive' as const } },
      { userId: null, manualLocalJcName: { contains: query, mode: 'insensitive' as const } },
      {
        ...(phoneGroupIds ? { groupId: { in: phoneGroupIds } } : {}),
        OR: [{ user: { phone: { contains: query } } }, { userId: null, manualPhone: { contains: query } }],
      },
    ],
  };
}

type CandidateSource = { groupId: string; status: string; user: { phone: string | null } | null };

export async function manualLinkCandidates(members: CandidateSource[]) {
  const pending = members.flatMap((member) =>
    member.status === 'PENDING' && member.user?.phone
      ? [{ groupId: member.groupId, manualPhone: member.user.phone }]
      : [],
  );
  if (!pending.length) return new Map<string, NonNullable<ReturnType<typeof toMemberView>['linkCandidate']>>();
  const matches = await prisma.gatheringMembership.findMany({
    where: { userId: null, status: 'ACTIVE', OR: pending },
  });
  return new Map(matches.map((row) => [JSON.stringify([row.groupId, row.manualPhone]), {
    membershipId: row.id,
    displayName: row.manualDisplayName ?? '이름 없음',
    localJcName: row.manualLocalJcName ?? '',
    phone: row.manualPhone,
  }]));
}

export function candidateFor(candidates: Awaited<ReturnType<typeof manualLinkCandidates>>, member: CandidateSource) {
  return member.status === 'PENDING' && member.user?.phone
    ? candidates.get(JSON.stringify([member.groupId, member.user.phone])) ?? null
    : null;
}
