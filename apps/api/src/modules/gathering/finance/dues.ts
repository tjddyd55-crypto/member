import type { Prisma } from '@prisma/client';
import { parseWon, parseWonAllowZero, dueStanding } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { assertGatheringWritable } from '../entitlement.js';
import { lockGroup } from '../locks.js';
import { lockGroupOpenYear, lockOpenYearById, lockOpenYearForInstant } from './years.js';

export type DueInput = {
  userId?: string;
  membershipId?: string;
  displayName?: string;
  year: number;
  amountWon: number;
  paidAmountWon: number;
  paidAt?: string | null;
  status?: 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED';
};

export async function upsertDue(actorId: string, groupId: string, input: DueInput) {
  const access = await requireGroupMember(actorId, groupId);
  assertPermission(access, 'FINANCE_WRITE');
  const amount = parseWon(input.amountWon);
  const paid = parseWonAllowZero(input.paidAmountWon);
  if (!amount.ok) throw new AppError(400, 'INVALID_AMOUNT', amount.message);
  if (!paid.ok) throw new AppError(400, 'INVALID_AMOUNT', paid.message);
  if (paid.value > amount.value) {
    throw new AppError(400, 'INVALID_AMOUNT', '납부액은 청구액을 넘을 수 없습니다.');
  }
  const paidAt = parseOptionalDate(input.paidAt);
  const status = input.status ?? dueStanding(amount.value, paid.value);
  const saved = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    await assertGatheringWritable(tx, groupId);
    const member = await resolveDueMember(tx, groupId, input);
    const identity = {
      groupId,
      OR: [
        { membershipId: member.id },
        ...(member.userId ? [{ membershipId: null, userId: member.userId }] : []),
      ],
    };
    const existing = paidAt
      ? await tx.gatheringMemberDue.findFirst({
          where: { ...identity, paidAt, financeYear: { year: input.year } },
          select: { financeYearId: true },
        })
      : null;
    let year;
    if (existing) {
      year = await lockOpenYearById(tx, groupId, existing.financeYearId);
    } else if (paidAt) {
      year = await lockOpenYearForInstant(tx, groupId, paidAt);
    } else {
      year = await lockGroupOpenYear(tx, groupId, input.year);
    }
    if (year.year !== input.year) {
      throw new AppError(409, 'PAYMENT_YEAR_MISMATCH', '납부일은 그 회계연도에 속해야 합니다.');
    }
    const current = await tx.gatheringMemberDue.findFirst({
      where: { ...identity, financeYearId: year.id },
    });
    const data = {
      userId: member.userId,
      membershipId: member.id,
      amountWon: amount.value,
      paidAmountWon: paid.value,
      paidAt,
      status,
    };
    return current
      ? tx.gatheringMemberDue.update({ where: { id: current.id }, data })
      : tx.gatheringMemberDue.create({ data: { ...data, groupId, financeYearId: year.id } });
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.DUE_UPSERT,
    targetType: 'GatheringMemberDue',
    targetId: saved.id,
  });
  return { id: saved.id, status: saved.status };
}

async function resolveDueMember(tx: Prisma.TransactionClient, groupId: string, input: DueInput) {
  const where = { groupId, status: 'ACTIVE' as const };
  if (input.membershipId || input.userId) {
    const member = await tx.gatheringMembership.findFirst({
      where: { ...where, id: input.membershipId, userId: input.userId },
    });
    if (!member) throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
    return member;
  }
  const name = input.displayName?.trim();
  if (!name) throw new AppError(400, 'MEMBER_REQUIRED', '회원 이름을 입력하세요.');
  const [match, second] = await tx.gatheringMembership.findMany({
    where: {
      ...where,
      OR: [
        { user: { gatheringProfile: { displayName: { contains: name } } } },
        { userId: null, manualDisplayName: { contains: name } },
      ],
    },
    take: 2,
  });
  if (!match) throw new AppError(404, 'MEMBER_NOT_FOUND', '그 이름의 회원을 찾을 수 없습니다.');
  if (second) throw new AppError(409, 'MEMBER_AMBIGUOUS', '같은 이름의 회원이 여러 명입니다. 더 정확히 입력하세요.');
  return match;
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_DATE', '납부일이 올바르지 않습니다.');
  return date;
}
