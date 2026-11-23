import type { Prisma } from '@prisma/client';
import { calendarYearKst, type GatheringRole } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { lockGroup } from './locks.js';
import { writeGatheringAudit } from './audit.js';
import { findYearContaining } from './finance/years.js';
import { GatheringAuditAction } from './constants.js';

type AssignInput = {
  userId?: string;
  membershipId?: string;
  role: Extract<GatheringRole, 'SECRETARY' | 'TREASURER' | 'EXECUTIVE'>;
  title?: string;
};

export async function assignGatheringRole(actorId: string, groupId: string, input: AssignInput) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'ROLE_ASSIGN');
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const target = await tx.gatheringMembership.findFirst({
      where: { groupId, status: 'ACTIVE', id: input.membershipId, userId: input.userId },
    });
    if (!target || (!input.membershipId && !input.userId)) {
      throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
    }
    const existing = await tx.gatheringRoleAssignment.findFirst({
      where: { membershipId: target.id, role: input.role, revokedAt: null },
    });
    if (existing) throw new AppError(409, 'ROLE_EXISTS', '이미 부여된 역할입니다.');
    return { assignmentId: await grantRole(tx, actorId, groupId, target, input) };
  });
}

export async function grantRole(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  groupId: string,
  member: { id: string; userId: string | null },
  input: Pick<AssignInput, 'role' | 'title'>,
) {
  const now = new Date();
  const year = await findYearContaining(tx, groupId, now);
  const created = await tx.gatheringRoleAssignment.create({
    data: {
      groupId,
      membershipId: member.id,
      userId: member.userId,
      role: input.role,
      title: input.role === 'EXECUTIVE' ? input.title : null,
      assignedByUserId: actorId,
    },
  });
  await tx.gatheringExecutiveTerm.create({
    data: {
      groupId,
      userId: member.userId,
      role: input.role,
      title: input.role === 'EXECUTIVE' ? input.title : null,
      membershipId: member.id,
      fiscalYear: year?.year ?? calendarYearKst(now),
      startedAt: now,
    },
  });
  if (actorId)
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: GatheringAuditAction.ROLE_ASSIGN,
      targetType: 'GatheringRoleAssignment',
      targetId: created.id,
      meta: { role: input.role },
    });
  return created.id;
}

export async function revokeGatheringRole(actorId: string, groupId: string, assignmentId: string) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'ROLE_ASSIGN');
  const assignment = await prisma.gatheringRoleAssignment.findFirst({
    where: { id: assignmentId, groupId },
  });
  if (!assignment || assignment.revokedAt) {
    throw new AppError(404, 'ROLE_NOT_FOUND', '역할을 찾을 수 없습니다.');
  }
  if (assignment.role === 'PRESIDENT') {
    throw new AppError(403, 'PRESIDENT_LOCKED', '회장 역할은 인계 절차에서만 바뀝니다.');
  }
  await closeRole(actorId, groupId, assignment.id);
  return { ok: true as const };
}

async function closeRole(actorId: string, groupId: string, assignmentId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const current = await tx.gatheringRoleAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
    const updated = await tx.gatheringRoleAssignment.updateMany({
      where: { id: assignmentId, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actorId },
    });
    if (updated.count !== 1)
      throw new AppError(409, 'ROLE_ALREADY_REVOKED', '이미 해제된 역할입니다.');
    await tx.gatheringExecutiveTerm.updateMany({
      where: {
        groupId,
        role: current.role,
        title: current.title,
        endedAt: null,
        OR: [
          { membershipId: current.membershipId },
          ...(current.userId ? [{ membershipId: null, userId: current.userId }] : []),
        ],
      },
      data: { endedAt: now },
    });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: GatheringAuditAction.ROLE_REVOKE,
      targetType: 'GatheringRoleAssignment',
      targetId: assignmentId,
      meta: { role: current.role },
    });
  });
}
