import { IDENTITY_LIMITATION_KO, normalizeKoreanMobile } from '@member/gathering-domain';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { hashNewPassword } from './account-insert.js';
import { writeGatheringAudit } from './audit.js';
import { assertActiveAccount, findAccount, findAccountByPhone, requirePhone } from './accounts.js';
import { GatheringAuditAction } from './constants.js';
import { normalizeRecoveryCode, sha256 } from './crypto.js';
import { toAuthProfile, toAuthUser } from './presenters/auth.js';
import { issueGatheringSession } from './sessions.js';

const INVALID_RECOVERY = '복구 코드가 올바르지 않거나 이미 사용되었습니다.';
const REQUEST_MESSAGE =
  '요청을 접수했습니다. 비밀번호는 자동으로 바뀌지 않습니다. 복구 코드가 없으면 앱에서 본인 확인을 마칠 수 없습니다.';

export async function redeemGatheringRecovery(input: {
  phone: string;
  recoveryCode: string;
  newPassword: string;
}) {
  const phone = requirePhone(input.phone);
  const user = await findAccountByPhone(phone);
  const code = await findUnusedCode(user?.id, user?.status, input.recoveryCode);
  if (!user || !code) throw new AppError(401, 'INVALID_RECOVERY', INVALID_RECOVERY);
  await burnRecoveryCode(user.id, code.id, await hashNewPassword(input.newPassword));
  return { ok: true as const };
}

async function findUnusedCode(
  userId: string | undefined,
  status: string | undefined,
  recoveryCode: string,
) {
  if (!userId || status !== 'ACTIVE') return null;
  return prisma.gatheringRecoveryCode.findFirst({
    where: { userId, codeHash: sha256(normalizeRecoveryCode(recoveryCode)), usedAt: null },
  });
}

async function burnRecoveryCode(userId: string, codeId: string, passwordHash: string) {
  await prisma.$transaction(async (tx) => {
    const burned = await tx.gatheringRecoveryCode.updateMany({
      where: { id: codeId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count !== 1) throw new AppError(401, 'INVALID_RECOVERY', INVALID_RECOVERY);
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    const revokedAt = new Date();
    await tx.gatheringSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
    await tx.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
    await writeGatheringAudit(tx, {
      actorUserId: userId,
      action: GatheringAuditAction.RECOVERY_REDEEM,
      targetType: 'User',
      targetId: userId,
    });
  });
}

export async function requestGatheringRecovery(input: { phone: string; note?: string }) {
  const phone = normalizeKoreanMobile(input.phone);
  if (phone) await recordRecoveryRequest(phone, input.note);
  return { accepted: true as const, message: REQUEST_MESSAGE };
}

async function recordRecoveryRequest(phone: string, note?: string) {
  const user = await findAccountByPhone(phone);
  if (!user) return;
  await prisma.gatheringRecoveryRequest.create({
    data: { userId: user.id, phoneHash: sha256(phone), note: note ?? null },
  });
  await writeGatheringAudit(prisma, {
    actorUserId: user.id,
    action: GatheringAuditAction.RECOVERY_REQUEST,
    targetType: 'User',
    targetId: user.id,
  });
}

export async function refreshGatheringSession(refreshToken: string, userAgent?: string) {
  const session = await prisma.gatheringSession.findUnique({
    where: { tokenHash: sha256(refreshToken) },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'INVALID_REFRESH', '리프레시 토큰이 유효하지 않습니다.');
  }
  const account = await findAccount(session.userId);
  if (!account || account.status !== 'ACTIVE') {
    throw new AppError(403, 'USER_BLOCKED', '사용할 수 없는 계정입니다.');
  }
  const tokens = await rotateSession(session.id, session.userId, userAgent);
  return { tokens };
}

async function rotateSession(sessionId: string, userId: string, userAgent?: string) {
  return prisma.$transaction(async (tx) => {
    const revoked = await tx.gatheringSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new AppError(401, 'INVALID_REFRESH', '리프레시 토큰이 유효하지 않습니다.');
    }
    const tokens = await issueGatheringSession(tx, userId, userAgent);
    await tx.gatheringSession.update({
      where: { tokenHash: sha256(tokens.refreshToken) },
      data: { replacedById: sessionId },
    });
    return tokens;
  });
}

export async function logoutGatheringSession(refreshToken?: string) {
  if (!refreshToken) return { ok: true as const };
  await prisma.gatheringSession.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { ok: true as const };
}

export async function getGatheringMe(userId: string) {
  const account = await findAccount(userId);
  assertActiveAccount(account);
  return {
    user: toAuthUser(account),
    profile: toAuthProfile(account),
    identityLimitation: IDENTITY_LIMITATION_KO,
  };
}
