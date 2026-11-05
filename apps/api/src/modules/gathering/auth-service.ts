import { verifyPassword } from '../../services/auth-service.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { writeGatheringAudit } from './audit.js';
import {
  assertActiveAccount,
  findAccount,
  findAccountByPhone,
  isUniqueViolation,
  requirePhone,
} from './accounts.js';
import { attachProfile, hashNewPassword, insertGatheringAccount } from './account-insert.js';
import { GatheringAuditAction } from './constants.js';
import { sessionBody, toAuthProfile, toAuthUser } from './presenters/auth.js';
import { issueGatheringSession } from './sessions.js';
import { IDENTITY_LIMITATION_KO } from '@member/gathering-domain';

type RegisterInput = {
  name: string;
  phone: string;
  password: string;
  localJcName: string;
  userAgent?: string;
};

export async function registerGatheringAccount(input: RegisterInput) {
  const phone = requirePhone(input.phone);
  const passwordHash = await hashNewPassword(input.password);
  try {
    const created = await prisma.$transaction((tx) =>
      insertGatheringAccount(tx, { ...input, phone, passwordHash }),
    );
    const account = await findAccount(created.userId);
    assertActiveAccount(account);
    return sessionBody(account, created.tokens, created.recoveryCodes);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        409,
        'PHONE_IN_USE',
        '이미 등록된 휴대폰 번호입니다. 로그인하거나 복구 코드를 사용하세요.',
      );
    }
    throw error;
  }
}

export async function loginGatheringAccount(
  phoneInput: string,
  password: string,
  userAgent?: string,
) {
  const phone = requirePhone(phoneInput);
  const user = await findAccountByPhone(phone);
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !passwordOk) {
    throw new AppError(
      401,
      'INVALID_CREDENTIALS',
      '휴대폰 번호 또는 비밀번호가 올바르지 않습니다.',
    );
  }
  if (user.status !== 'ACTIVE') {
    throw new AppError(403, 'USER_BLOCKED', '사용할 수 없는 계정입니다.');
  }
  const tokens = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeGatheringAudit(tx, { actorUserId: user.id, action: GatheringAuditAction.LOGIN });
    return issueGatheringSession(tx, user.id, userAgent);
  });
  return sessionBody(user, tokens);
}

export async function completeGatheringProfile(
  userId: string,
  input: { name: string; localJcName: string },
) {
  const existing = await prisma.gatheringProfile.findUnique({ where: { userId } });
  if (existing) {
    throw new AppError(409, 'PROFILE_EXISTS', '이미 모임 프로필이 있습니다.');
  }
  const recoveryCodes = await prisma.$transaction(async (tx) => {
    const codes = await attachProfile(tx, {
      userId,
      name: input.name,
      localJcName: input.localJcName,
      now: new Date(),
    });
    await writeGatheringAudit(tx, {
      actorUserId: userId,
      action: GatheringAuditAction.PROFILE_COMPLETE,
      targetType: 'GatheringProfile',
      targetId: userId,
    });
    return codes;
  });
  const account = await findAccount(userId);
  assertActiveAccount(account);
  return {
    user: toAuthUser(account),
    profile: toAuthProfile(account),
    identityLimitation: IDENTITY_LIMITATION_KO,
    recoveryCodes,
  };
}
