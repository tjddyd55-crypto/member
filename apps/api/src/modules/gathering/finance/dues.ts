import { fiscalYearOf, parseWon, parseWonAllowZero, dueStanding } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { lockGroupOpenYear } from './years.js';

export type DueInput = {
  userId: string;
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
  const member = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId: input.userId } },
  });
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
  }
  const saved = await prisma.$transaction(async (tx) => {
    const year = await lockGroupOpenYear(tx, groupId, input.year);
    if (paidAt && fiscalYearOf(paidAt) !== year.year) {
      throw new AppError(409, 'PAYMENT_YEAR_MISMATCH', '납부일은 그 회계연도에 속해야 합니다.');
    }
    return tx.gatheringMemberDue.upsert({
      where: { groupId_userId_financeYearId: { groupId, userId: input.userId, financeYearId: year.id } },
      create: {
        groupId,
        userId: input.userId,
        financeYearId: year.id,
        amountWon: amount.value,
        paidAmountWon: paid.value,
        paidAt,
        status,
      },
      update: {
        amountWon: amount.value,
        paidAmountWon: paid.value,
        paidAt,
        status,
      },
    });
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

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_DATE', '납부일이 올바르지 않습니다.');
  return date;
}
