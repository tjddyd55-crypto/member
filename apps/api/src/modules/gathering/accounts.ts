import { normalizeKoreanMobile } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AccountRecord } from './presenters/auth.js';

const accountInclude = {
  gatheringProfile: true,
  gatheringAffiliations: { where: { isCurrent: true }, take: 1 },
} as const;

export function requirePhone(input: string) {
  const phone = normalizeKoreanMobile(input);
  if (!phone) {
    throw new AppError(400, 'INVALID_PHONE', '010으로 시작하는 휴대폰 번호를 입력하세요.');
  }
  return phone;
}

export async function findAccount(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, include: accountInclude });
}

export async function findAccountByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone }, include: accountInclude });
}

export function assertActiveAccount(user: AccountRecord | null): asserts user is AccountRecord {
  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  }
}

export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
