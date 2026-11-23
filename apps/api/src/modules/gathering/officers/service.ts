import type { GatheringOfficerTermView, GatheringOfficerView } from '@member/contracts';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';

export async function listGatheringOfficers(userId: string, groupId: string) {
  await requireGroupMember(userId, groupId, 'read');
  const [currentRows, historyRows] = await Promise.all([
    prisma.gatheringRoleAssignment.findMany({
      where: { groupId, revokedAt: null, role: { not: 'MEMBER' } },
      include: { user: { include: { gatheringProfile: true } }, membership: { select: { manualDisplayName: true } } },
      orderBy: { assignedAt: 'asc' },
    }),
    prisma.gatheringExecutiveTerm.findMany({
      where: { groupId },
      include: { user: { include: { gatheringProfile: true } }, membership: { select: { manualDisplayName: true } } },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const current: GatheringOfficerView[] = currentRows.map((row) => ({
    assignmentId: row.id,
    userId: row.userId,
    membershipId: row.membershipId,
    isAppRegistered: row.userId !== null,
    displayName:
      row.userId === null
        ? (row.membership?.manualDisplayName ?? '이름 없음')
        : (row.user?.gatheringProfile?.displayName ?? '이름 없음'),
    role: row.role,
    title: row.title,
    assignedAt: row.assignedAt.toISOString(),
  }));
  const history: GatheringOfficerTermView[] = historyRows.map((row) => ({
    id: row.id,
    userId: row.userId,
    membershipId: row.membershipId,
    isAppRegistered: row.userId !== null,
    displayName:
      row.userId === null
        ? (row.membership?.manualDisplayName ?? '이름 없음')
        : (row.user?.gatheringProfile?.displayName ?? '이름 없음'),
    role: row.role,
    title: row.title,
    fiscalYear: row.fiscalYear,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  }));
  return { current, history };
}
