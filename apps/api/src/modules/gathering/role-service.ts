import type { GatheringRole as PrismaGatheringRole } from '@prisma/client';
import { fiscalYearOf, type GatheringRole } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';

type AssignInput = {
  userId: string;
  role: Extract<GatheringRole, 'SECRETARY' | 'TREASURER' | 'EXECUTIVE'>;
  title?: string;
};

export async function assignGatheringRole(actorId: string, groupId: string, input: AssignInput) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'ROLE_ASSIGN');
  const target = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId: input.userId } },
  });
  if (!target || target.status !== 'ACTIVE') {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
  }
  await assertRoleAvailable(target.id, input.role);
  const assignmentId = await grantRole(actorId, groupId, target.id, input);
  return { assignmentId };
}

async function assertRoleAvailable(membershipId: string, role: AssignInput['role']) {
  const existing = await prisma.gatheringRoleAssignment.findFirst({
    where: { membershipId, role, revokedAt: null },
  });
  if (existing) throw new AppError(409, 'ROLE_EXISTS', '이미 부여된 역할입니다.');
}

async function grantRole(
  actorId: string,
  groupId: string,
  membershipId: string,
  input: AssignInput,
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const created = await tx.gatheringRoleAssignment.create({
      data: {
        groupId,
        membershipId,
        userId: input.userId,
        role: input.role,
        title: input.role === 'EXECUTIVE' ? input.title : null,
        assignedByUserId: actorId,
      },
    });
    await tx.gatheringExecutiveTerm.create({
      data: {
        groupId,
        userId: input.userId,
        role: input.role,
        title: input.role === 'EXECUTIVE' ? input.title : null,
        fiscalYear: fiscalYearOf(now),
        startedAt: now,
      },
    });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: GatheringAuditAction.ROLE_ASSIGN,
      targetType: 'GatheringRoleAssignment',
      targetId: created.id,
      meta: { role: input.role },
    });
    return created.id;
  });
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
  await closeRole(actorId, groupId, assignment);
  return { ok: true as const };
}

async function closeRole(
  actorId: string,
  groupId: string,
  assignment: { id: string; userId: string; role: PrismaGatheringRole },
) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.gatheringRoleAssignment.updateMany({
      where: { id: assignment.id, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actorId },
    });
    if (updated.count !== 1)
      throw new AppError(409, 'ROLE_ALREADY_REVOKED', '이미 해제된 역할입니다.');
    await tx.gatheringExecutiveTerm.updateMany({
      where: { groupId, userId: assignment.userId, role: assignment.role, endedAt: null },
      data: { endedAt: now },
    });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: actorId,
      action: GatheringAuditAction.ROLE_REVOKE,
      targetType: 'GatheringRoleAssignment',
      targetId: assignment.id,
      meta: { role: assignment.role },
    });
  });
}
