import type { Prisma } from '@prisma/client';
import { fiscalYearOf, fiscalYearRange, isValidFiscalPeriod, type FiscalPeriod } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPermission, requireGroupMember } from './access.js';
import { writeGatheringAudit } from './audit.js';
import { GatheringAuditAction } from './constants.js';
import { getGroupDetail } from './group-read.js';
import { lockGroup } from './locks.js';

export async function createGroup(userId: string, input: { name: string; description?: string }) {
  const profile = await prisma.gatheringProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new AppError(409, 'PROFILE_REQUIRED', '모임에 쓸 이름과 소속 로컬을 먼저 등록하세요.');
  }
  const groupId = await prisma.$transaction((tx) =>
    insertGroup(tx, userId, profile.directoryConsentAt, input),
  );
  return getGroupDetail(userId, groupId);
}

async function insertGroup(
  tx: Prisma.TransactionClient,
  userId: string,
  consentAt: Date,
  input: { name: string; description?: string },
) {
  const now = new Date();
  const year = fiscalYearOf(now);
  const range = fiscalYearRange(year);
  const group = await tx.gatheringGroup.create({
    data: {
      name: input.name,
      description: input.description ? input.description : null,
      createdByUserId: userId,
    },
  });
  const membership = await tx.gatheringMembership.create({
    data: {
      groupId: group.id,
      userId,
      status: 'ACTIVE',
      directoryConsentAt: consentAt,
      joinedAt: now,
    },
  });
  await tx.gatheringRoleAssignment.create({
    data: {
      groupId: group.id,
      membershipId: membership.id,
      userId,
      role: 'PRESIDENT',
      assignedByUserId: userId,
    },
  });
  await tx.gatheringExecutiveTerm.create({
    data: { groupId: group.id, userId, role: 'PRESIDENT', fiscalYear: year, startedAt: now },
  });
  await tx.gatheringFinanceYear.create({
    data: {
      groupId: group.id,
      year,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      status: 'OPEN',
      openingBalanceWon: 0,
    },
  });
  await writeGatheringAudit(tx, {
    groupId: group.id,
    actorUserId: userId,
    action: GatheringAuditAction.GROUP_CREATE,
    targetType: 'GatheringGroup',
    targetId: group.id,
  });
  return group.id;
}

type GroupPatch = {
  name?: string;
  description?: string | null;
  inviteRequiresApproval?: boolean;
  fiscalStartMonth?: number;
  fiscalStartDay?: number;
};

export async function updateGroup(userId: string, groupId: string, input: GroupPatch) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'GROUP_SETTINGS');
  if (input.fiscalStartMonth != null || input.fiscalStartDay != null) {
    if (input.fiscalStartMonth == null || input.fiscalStartDay == null) {
      throw new AppError(400, 'INVALID_PERIOD', '회계 시작 월과 일을 함께 지정하세요.');
    }
    await changeFiscalPeriod(groupId, { startMonth: input.fiscalStartMonth, startDay: input.fiscalStartDay });
  }
  if (input.name != null || input.description !== undefined || input.inviteRequiresApproval != null) {
    await prisma.gatheringGroup.update({
      where: { id: groupId },
      data: {
        name: input.name,
        description: input.description,
        inviteRequiresApproval: input.inviteRequiresApproval,
      },
    });
  }
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.GROUP_UPDATE,
    targetType: 'GatheringGroup',
    targetId: groupId,
  });
  return getGroupDetail(userId, groupId);
}

async function changeFiscalPeriod(groupId: string, period: FiscalPeriod) {
  if (!isValidFiscalPeriod(period)) {
    throw new AppError(400, 'INVALID_PERIOD', '그 달에는 없는 시작일입니다.');
  }
  await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const open = await tx.gatheringFinanceYear.findFirst({
      where: { groupId, status: 'OPEN' },
      orderBy: { year: 'desc' },
    });
    if (open) {
      const [transactions, dues, receipts] = await Promise.all([
        tx.gatheringFinanceTransaction.count({ where: { financeYearId: open.id } }),
        tx.gatheringMemberDue.count({ where: { financeYearId: open.id } }),
        tx.gatheringReceiptAsset.count({ where: { financeYearId: open.id, deletedAt: null } }),
      ]);
      if (transactions + dues + receipts > 0) {
        throw new AppError(409, 'PERIOD_LOCKED', '거래나 회비, 영수증이 있는 회계연도의 기간은 바꿀 수 없습니다.');
      }
      const range = fiscalYearRange(open.year, period);
      const others = await tx.gatheringFinanceYear.findMany({
        where: { groupId, id: { not: open.id } },
        select: { startsAt: true, endsAt: true },
      });
      if (others.some((other) => other.startsAt <= range.endsAt && range.startsAt <= other.endsAt)) {
        throw new AppError(409, 'PERIOD_OVERLAP', '바꾼 기간이 다른 회계연도와 겹칩니다.');
      }
      await tx.gatheringFinanceYear.update({
        where: { id: open.id },
        data: { startsAt: range.startsAt, endsAt: range.endsAt },
      });
    }
    await tx.gatheringGroup.update({
      where: { id: groupId },
      data: { fiscalStartMonth: period.startMonth, fiscalStartDay: period.startDay },
    });
  });
}
