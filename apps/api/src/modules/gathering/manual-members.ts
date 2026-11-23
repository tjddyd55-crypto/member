import type { GatheringManualMemberInput } from '@member/contracts';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requirePhone } from './accounts.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { memberInclude } from './group-read.js';
import { lockGroup } from './locks.js';
import { toMemberView } from './presenters/group.js';
import { grantRole } from './role-service.js';
import { writeAdminAudit } from './admin/audit.js';

export type ManualMemberChange =
  | { action: 'CREATE'; input: GatheringManualMemberInput }
  | {
      action: 'UPDATE';
      membershipId: string;
      input: Pick<GatheringManualMemberInput, 'name' | 'phone' | 'localJcName'>;
    }
  | { action: 'DELETE'; membershipId: string }
  | { action: 'LINK'; membershipId: string; targetMembershipId: string };

type Actor = { userId: string } | { adminId: string; contactRead: boolean };
type Tx = Prisma.TransactionClient;

export function manageManualMember(actorId: string, groupId: string, change: ManualMemberChange) {
  return applyManualMemberChange({ userId: actorId }, groupId, change);
}

export function linkManualMember(
  actorId: string,
  groupId: string,
  manualMembershipId: string,
  targetMembershipId: string,
) {
  return manageManualMember(actorId, groupId, {
    action: 'LINK',
    membershipId: manualMembershipId,
    targetMembershipId,
  });
}

export async function applyManualMemberChange(
  actor: Actor,
  groupId: string,
  change: ManualMemberChange,
) {
  const actorId = 'userId' in actor ? actor.userId : null;
  if (actorId) await requireGroupMember(actorId, groupId);
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const access = actorId ? await requireGroupMember(actorId, groupId, 'write', tx) : null;
    if (access) {
      assertPermission(access, 'MEMBER_MANAGE');
      if (change.action === 'CREATE' && change.input.role && change.input.role !== 'MEMBER') {
        assertPermission(access, 'ROLE_ASSIGN');
      }
    }
    const now = new Date();
    const audit = async (targetId: string, meta?: { resultingMembershipId: string }) => {
      const entry = {
        groupId,
        action: `GATHERING_MANUAL_MEMBER_${change.action}`,
        targetType: 'GatheringMembership',
        targetId,
      };
      if ('adminId' in actor) {
        await writeAdminAudit(tx, { ...entry, actorAdminId: actor.adminId, after: meta });
      } else {
        await writeGatheringAudit(tx, { ...entry, actorUserId: actor.userId, meta });
      }
    };
    const targetId = change.action === 'CREATE' ? undefined : change.membershipId;
    if (targetId) {
      const member = await tx.gatheringMembership.findFirst({ where: { id: targetId, groupId } });
      if (
        !member ||
        member.status === 'WITHDRAWN' ||
        (change.action === 'UPDATE' && member.status === 'REJECTED')
      ) {
        throw new AppError(404, 'MEMBER_NOT_FOUND', '회원을 찾을 수 없습니다.');
      }
      if (member.userId !== null)
        throw new AppError(409, 'ALREADY_LINKED', '이미 앱 계정이 연결된 회원입니다.');
      if (change.action === 'LINK') {
        if (member.status !== 'ACTIVE')
          throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
        if (access) {
          const officerRole = await tx.gatheringRoleAssignment.findFirst({
            where: { membershipId: member.id, revokedAt: null, role: { not: 'MEMBER' } },
          });
          if (officerRole) assertPermission(access, 'ROLE_ASSIGN');
        }
        const result = await linkInside(
          tx,
          groupId,
          member.id,
          change.targetMembershipId,
          actorId,
          now,
        );
        await audit(member.id, { resultingMembershipId: result.membershipId });
        return result;
      }
      if (change.action === 'DELETE') {
        await tx.gatheringMembership.update({
          where: { id: member.id },
          data: { status: 'WITHDRAWN' },
        });
        await tx.gatheringRoleAssignment.updateMany({
          where: { membershipId: member.id, revokedAt: null },
          data: { revokedAt: now, revokedByUserId: actorId },
        });
        await tx.gatheringExecutiveTerm.updateMany({
          where: { membershipId: member.id, endedAt: null },
          data: { endedAt: now },
        });
        await audit(member.id);
        return { ok: true as const };
      }
    }
    if (change.action !== 'CREATE' && change.action !== 'UPDATE') {
      throw new AppError(404, 'MEMBER_NOT_FOUND', '회원을 찾을 수 없습니다.');
    }
    const phone = requirePhone(change.input.phone);
    await checkPhone(tx, groupId, phone, targetId);
    const data = {
      manualDisplayName: change.input.name,
      manualPhone: phone,
      manualLocalJcName: change.input.localJcName,
    };
    const { id } =
      change.action === 'CREATE'
        ? await tx.gatheringMembership.create({
            data: {
              ...data,
              groupId,
              status: 'ACTIVE',
              addedByUserId: actorId,
              joinedAt: now,
              approvedAt: now,
              approvedByUserId: actorId,
            },
          })
        : await tx.gatheringMembership.update({ where: { id: change.membershipId }, data });
    if (change.action === 'CREATE') {
      await tx.gatheringRoleAssignment.create({
        data: { groupId, membershipId: id, role: 'MEMBER', assignedByUserId: actorId },
      });
      const { role, title } = change.input;
      if (role === 'EXECUTIVE' && !title)
        throw new AppError(400, 'TITLE_REQUIRED', '추가 집행부 직함이 필요합니다.');
      if (role && role !== 'MEMBER')
        await grantRole(tx, actorId, groupId, { id, userId: null }, { role, title });
    }
    await audit(id);
    const member = toMemberView(
      await tx.gatheringMembership.findUniqueOrThrow({ where: { id }, include: memberInclude }),
    );
    return {
      member: 'adminId' in actor && !actor.contactRead ? { ...member, phone: null } : member,
    };
  });
}

async function checkPhone(tx: Tx, groupId: string, phone: string, membershipId?: string) {
  const where = {
    groupId,
    id: { not: membershipId },
    status: { in: ['ACTIVE', 'PENDING', 'SUSPENDED'] },
  } satisfies Prisma.GatheringMembershipWhereInput;
  const registered = await tx.gatheringMembership.findFirst({
    where: { ...where, user: { phone } },
  });
  if (registered)
    throw new AppError(
      409,
      'PHONE_IN_USE',
      '이미 같은 휴대폰 번호를 쓰는 앱 가입 회원이 있습니다.',
    );
  const manual = await tx.gatheringMembership.findFirst({
    where: { ...where, userId: null, manualPhone: phone },
  });
  if (manual)
    throw new AppError(
      409,
      'MANUAL_MEMBER_EXISTS',
      '이미 같은 휴대폰 번호의 앱 미가입 회원이 있습니다.',
    );
}

async function linkInside(
  tx: Tx,
  groupId: string,
  manualId: string,
  targetId: string,
  actorId: string | null,
  now: Date,
) {
  const target = await tx.gatheringMembership.findFirst({
    where: { id: targetId, groupId, status: { in: ['PENDING', 'ACTIVE'] } },
  });
  if (!target?.userId)
    throw new AppError(404, 'MEMBER_NOT_FOUND', '연결할 앱 가입 회원을 찾을 수 없습니다.');
  const userId = target.userId;
  const linkData = {
    linkedAt: now,
    linkedByUserId: actorId,
    manualDisplayName: null,
    manualPhone: null,
    manualLocalJcName: null,
  };
  const targetRecords = { groupId, OR: [{ membershipId: targetId }, { userId }] };
  if (target.status === 'PENDING') {
    const [role, term, due] = await Promise.all([
      tx.gatheringRoleAssignment.findFirst({
        where: { membershipId: targetId, revokedAt: null, role: { not: 'MEMBER' } },
      }),
      tx.gatheringExecutiveTerm.findFirst({ where: targetRecords }),
      tx.gatheringMemberDue.findFirst({ where: targetRecords }),
    ]);
    if (role || term || due)
      throw new AppError(
        409,
        'MEMBER_RECORD_CONFLICT',
        '참여 요청에 연결할 수 없는 기존 기록이 있습니다.',
      );
    await tx.gatheringRoleAssignment.deleteMany({
      where: { membershipId: targetId, role: 'MEMBER' },
    });
    await tx.gatheringRoleAssignment.updateMany({
      where: { membershipId: targetId },
      data: { membershipId: manualId },
    });
    await tx.gatheringMembership.delete({ where: { id: targetId } });
    await tx.gatheringMembership.update({
      where: { id: manualId },
      data: {
        ...linkData,
        userId,
        directoryConsentAt: target.directoryConsentAt,
        approvedAt: now,
        approvedByUserId: actorId,
      },
    });
    await tx.gatheringRoleAssignment.updateMany({
      where: { membershipId: manualId },
      data: { userId },
    });
    await transferRecords(tx, manualId, manualId, userId);
    return { ok: true as const, membershipId: manualId, userId };
  }

  const dues = await tx.gatheringMemberDue.findMany({
    where: { membershipId: manualId },
    select: { financeYearId: true },
  });
  if (
    dues.length &&
    (await tx.gatheringMemberDue.findFirst({
      where: { ...targetRecords, financeYearId: { in: dues.map((due) => due.financeYearId) } },
    }))
  ) {
    throw new AppError(
      409,
      'DUE_CONFLICT',
      '해당 회계연도의 회비 기록이 양쪽에 모두 있어 연결할 수 없습니다.',
    );
  }
  const roles = await tx.gatheringRoleAssignment.findMany({
    where: { membershipId: { in: [manualId, targetId] }, revokedAt: null },
  });
  const targetRoles = roles.filter((role) => role.membershipId === targetId);
  for (const role of roles.filter((row) => row.membershipId === manualId)) {
    const duplicate = targetRoles.some((row) => row.role === role.role && row.title === role.title);
    await tx.gatheringRoleAssignment.update({
      where: { id: role.id },
      data: duplicate
        ? { revokedAt: now, revokedByUserId: actorId }
        : { membershipId: targetId, userId },
    });
  }
  await transferRecords(tx, manualId, targetId, userId);
  await tx.gatheringMembership.update({
    where: { id: manualId },
    data: { ...linkData, status: 'WITHDRAWN' },
  });
  return { ok: true as const, membershipId: targetId, userId };
}

async function transferRecords(tx: Tx, fromId: string, membershipId: string, userId: string) {
  await tx.gatheringExecutiveTerm.updateMany({
    where: { membershipId: fromId },
    data: { membershipId, userId },
  });
  await tx.gatheringMemberDue.updateMany({
    where: { membershipId: fromId },
    data: { membershipId, userId },
  });
}
