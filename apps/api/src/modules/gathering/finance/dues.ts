import { fiscalYearOf, parseWon, parseWonAllowZero, dueStanding } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { lockGroup } from '../locks.js';
import { lockGroupOpenYear, readFiscalPeriod } from './years.js';

export type DueInput = {
  userId?: string;
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
  const userId = await resolveDueMember(groupId, input);
  const member = await prisma.gatheringMembership.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!member || member.status !== 'ACTIVE') {
    throw new AppError(404, 'MEMBER_NOT_FOUND', '활동 중인 회원을 찾을 수 없습니다.');
  }
  const saved = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const period = await readFiscalPeriod(tx, groupId);
    const year = await lockGroupOpenYear(tx, groupId, input.year);
    if (paidAt && fiscalYearOf(paidAt, period) !== year.year) {
      throw new AppError(409, 'PAYMENT_YEAR_MISMATCH', '납부일은 그 회계연도에 속해야 합니다.');
    }
    return tx.gatheringMemberDue.upsert({
      where: { groupId_userId_financeYearId: { groupId, userId, financeYearId: year.id } },
      create: {
        groupId,
        userId,
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

async function resolveDueMember(groupId: string, input: DueInput) {
  if (input.userId) return input.userId;
  const name = input.displayName?.trim();
  if (!name) throw new AppError(400, 'MEMBER_REQUIRED', '회원 이름을 입력하세요.');
  const members = await prisma.gatheringMembership.findMany({
    where: { groupId, status: 'ACTIVE', user: { gatheringProfile: { displayName: { contains: name } } } },
    select: { userId: true },
  });
  if (members.length === 0) throw new AppError(404, 'MEMBER_NOT_FOUND', '그 이름의 회원을 찾을 수 없습니다.');
  const match = members[0];
  if (!match || members.length > 1) {
    throw new AppError(409, 'MEMBER_AMBIGUOUS', '같은 이름의 회원이 여러 명입니다. 더 정확히 입력하세요.');
  }
  return match.userId;
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_DATE', '납부일이 올바르지 않습니다.');
  return date;
}
