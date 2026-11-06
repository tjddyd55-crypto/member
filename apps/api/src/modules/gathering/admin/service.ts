import {
  ADMIN_ENROLLMENT_MS,
  ADMIN_PASSWORD_MIN,
  adminLockUntil,
  adminLoginBlocked,
  canManageAdminAccounts,
  isAdminCapability,
  sessionExpiry,
  type AdminCapability,
  type AdminRole,
} from '@member/gathering-domain';
import { Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from '../../../services/auth-service.js';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { randomToken, sha256 } from '../crypto.js';
import { writeAdminAudit } from './audit.js';
import { decryptAdminSecret, encryptAdminSecret, generateTotpSecret, otpauthUrl, totpMatches } from './totp.js';

type SessionBody = {
  token: string;
  csrfToken: string;
  expiresAt: string;
  admin: { id: string; loginId: string; role: AdminRole };
};

export async function loginAdmin(
  input: { loginId: string; password: string; totpCode?: string; userAgent?: string },
  now = new Date(),
) {
  const loginId = normalizeLogin(input.loginId);
  const account = await prisma.gatheringAdminAccount.findUnique({ where: { loginId } });
  const passwordOk = account ? await verifyPassword(input.password, account.passwordHash) : false;
  if (!account || !passwordOk) {
    if (account) {
      await recordFailure(account.id, now);
      await writeAdminAudit(prisma, {
        actorAdminId: account.id,
        action: 'ADMIN_LOGIN_FAILED',
        targetType: 'GatheringAdminAccount',
        targetId: account.id,
      });
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  if (account.disabledAt) {
    await writeAdminAudit(prisma, {
      actorAdminId: account.id,
      action: 'ADMIN_LOGIN_DISABLED',
      targetType: 'GatheringAdminAccount',
      targetId: account.id,
    });
    throw new AppError(403, 'ACCOUNT_DISABLED', '사용할 수 없는 관리자 계정입니다.');
  }
  if (adminLoginBlocked(account.lockedUntil, now)) {
    await writeAdminAudit(prisma, {
      actorAdminId: account.id,
      action: 'ADMIN_LOGIN_LOCKED',
      targetType: 'GatheringAdminAccount',
      targetId: account.id,
    });
    throw new AppError(429, 'ADMIN_LOCKED', '로그인 시도가 잠겨 있습니다. 잠시 뒤 다시 하세요.');
  }
  if (!account.totpConfirmedAt || !account.totpSecretCipher) {
    const enrollment = await issueEnrollment(account.id, now);
    await writeAdminAudit(prisma, {
      actorAdminId: account.id,
      action: 'ADMIN_ENROLLMENT_STARTED',
      targetType: 'GatheringAdminAccount',
      targetId: account.id,
    });
    return { kind: 'enrollment' as const, enrollmentToken: enrollment.token, expiresAt: enrollment.expiresAt.toISOString() };
  }
  const secret = decryptAdminSecret(account.totpSecretCipher);
  if (!input.totpCode || !totpMatches(secret, input.totpCode, now.getTime())) {
    await recordFailure(account.id, now);
    await writeAdminAudit(prisma, {
      actorAdminId: account.id,
      action: 'ADMIN_TOTP_FAILED',
      targetType: 'GatheringAdminAccount',
      targetId: account.id,
    });
    throw new AppError(401, 'TOTP_INVALID', '인증 코드가 올바르지 않습니다.');
  }
  const session = await openSession(account.id, input.userAgent, now, 'ADMIN_LOGIN');
  return { kind: 'session' as const, ...session };
}

export async function startAdminTotp(enrollmentToken: string, now = new Date()) {
  const row = await requireEnrollment(enrollmentToken, now);
  const secret = generateTotpSecret();
  await prisma.gatheringAdminEnrollment.update({
    where: { id: row.id },
    data: { pendingSecretCipher: encryptAdminSecret(secret) },
  });
  const account = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { id: row.adminId } });
  return { secret, otpauthUrl: otpauthUrl(account.loginId, secret) };
}

export async function confirmAdminTotp(
  enrollmentToken: string,
  code: string,
  userAgent?: string,
  now = new Date(),
) {
  const row = await requireEnrollment(enrollmentToken, now);
  if (!row.pendingSecretCipher) {
    throw new AppError(409, 'TOTP_NOT_STARTED', '인증 앱 등록을 먼저 시작하세요.');
  }
  const secret = decryptAdminSecret(row.pendingSecretCipher);
  if (!totpMatches(secret, code, now.getTime())) {
    await recordFailure(row.adminId, now);
    throw new AppError(401, 'TOTP_INVALID', '인증 코드가 올바르지 않습니다.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.gatheringAdminEnrollment.updateMany({
      where: { adminId: row.adminId, usedAt: null },
      data: { usedAt: now, pendingSecretCipher: null },
    });
    await tx.gatheringAdminAccount.update({
      where: { id: row.adminId },
      data: {
        totpSecretCipher: encryptAdminSecret(secret),
        totpConfirmedAt: now,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    await writeAdminAudit(tx, {
      actorAdminId: row.adminId,
      action: 'ADMIN_TOTP_CONFIRMED',
      targetType: 'GatheringAdminAccount',
      targetId: row.adminId,
    });
  });
  return openSession(row.adminId, userAgent, now, 'ADMIN_LOGIN');
}

export async function logoutAdmin(sessionId: string, actorAdminId: string) {
  await prisma.gatheringAdminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeAdminAudit(prisma, {
    actorAdminId,
    action: 'ADMIN_LOGOUT',
    targetType: 'GatheringAdminSession',
    targetId: sessionId,
  });
}

export async function changeAdminPassword(adminId: string, currentPassword: string, nextPassword: string) {
  if (nextPassword.length < ADMIN_PASSWORD_MIN) {
    throw new AppError(400, 'WEAK_PASSWORD', '비밀번호는 12자 이상이어야 합니다.');
  }
  const account = await prisma.gatheringAdminAccount.findUnique({ where: { id: adminId } });
  if (!account || !(await verifyPassword(currentPassword, account.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', '현재 비밀번호가 올바르지 않습니다.');
  }
  if (await verifyPassword(nextPassword, account.passwordHash)) {
    throw new AppError(400, 'PASSWORD_UNCHANGED', '다른 비밀번호를 입력하세요.');
  }
  const passwordHash = await hashPassword(nextPassword);
  await prisma.$transaction(async (tx) => {
    await tx.gatheringAdminAccount.update({
      where: { id: adminId },
      data: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
    });
    await tx.gatheringAdminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action: 'ADMIN_PASSWORD_CHANGE',
      targetType: 'GatheringAdminAccount',
      targetId: adminId,
    });
  });
}

export async function createManagedAdmin(
  actorId: string,
  input: {
    loginId: string;
    password: string;
    role: AdminRole;
    scopes: { groupId: string; capability: AdminCapability }[];
    reason: string;
  },
) {
  const actor = await prisma.gatheringAdminAccount.findUnique({ where: { id: actorId } });
  if (!actor || !canManageAdminAccounts(actor.role, actor.disabledAt != null)) {
    throw new AppError(403, 'FORBIDDEN', '관리자 계정을 만들 권한이 없습니다.');
  }
  if (input.password.length < ADMIN_PASSWORD_MIN) {
    throw new AppError(400, 'WEAK_PASSWORD', '비밀번호는 12자 이상이어야 합니다.');
  }
  if (!input.reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
  if (input.role === 'SUPER_ADMIN' && input.scopes.length > 0) {
    throw new AppError(400, 'SCOPE_NOT_ALLOWED', '슈퍼관리자는 모임 범위를 따로 두지 않습니다.');
  }
  if (input.role === 'ADMIN' && input.scopes.length === 0) {
    throw new AppError(400, 'SCOPE_REQUIRED', '담당 관리자는 모임과 업무를 지정해야 합니다.');
  }
  for (const scope of input.scopes) {
    if (!isAdminCapability(scope.capability)) {
      throw new AppError(400, 'UNKNOWN_CAPABILITY', '알 수 없는 권한입니다.');
    }
    const group = await prisma.gatheringGroup.findUnique({ where: { id: scope.groupId }, select: { id: true } });
    if (!group) throw new AppError(404, 'GROUP_NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const account = await tx.gatheringAdminAccount.create({
        data: { loginId: normalizeLogin(input.loginId), passwordHash, role: input.role },
      });
      if (input.scopes.length > 0) {
        await tx.gatheringAdminScope.createMany({
          data: input.scopes.map((scope) => ({
            adminId: account.id,
            groupId: scope.groupId,
            capability: scope.capability,
          })),
        });
      }
      await writeAdminAudit(tx, {
        actorAdminId: actorId,
        action: 'ADMIN_CREATE',
        targetType: 'GatheringAdminAccount',
        targetId: account.id,
        after: { loginId: account.loginId, role: account.role, scopes: input.scopes },
        reason: input.reason.trim(),
      });
      return account;
    });
    return { id: created.id, loginId: created.loginId, role: created.role };
  } catch (error) {
    if (isUnique(error)) throw new AppError(409, 'LOGIN_IN_USE', '이미 있는 관리자 아이디입니다.');
    throw error;
  }
}

export async function disableManagedAdmin(actorId: string, targetId: string, reason: string) {
  if (!reason.trim()) throw new AppError(400, 'REASON_REQUIRED', '사유를 입력하세요.');
  if (actorId === targetId) throw new AppError(409, 'CANNOT_DISABLE_SELF', '자기 계정은 여기서 끄지 않습니다.');
  const actor = await prisma.gatheringAdminAccount.findUnique({ where: { id: actorId } });
  if (!actor || !canManageAdminAccounts(actor.role, actor.disabledAt != null)) {
    throw new AppError(403, 'FORBIDDEN', '관리자 계정을 끌 권한이 없습니다.');
  }
  const target = await prisma.gatheringAdminAccount.findUnique({ where: { id: targetId } });
  if (!target) throw new AppError(404, 'ADMIN_NOT_FOUND', '관리자 계정을 찾을 수 없습니다.');
  await prisma.$transaction(async (tx) => {
    if (target.role === 'SUPER_ADMIN' && target.disabledAt == null) {
      await tx.gatheringAdminAccount.updateMany({
        where: { role: 'SUPER_ADMIN' },
        data: { updatedAt: new Date() },
      });
      const others = await tx.gatheringAdminAccount.count({
        where: { role: 'SUPER_ADMIN', disabledAt: null, id: { not: targetId } },
      });
      if (others < 1) throw new AppError(409, 'LAST_SUPER_ADMIN', '마지막 슈퍼관리자는 끌 수 없습니다.');
    }
    await tx.gatheringAdminAccount.update({ where: { id: targetId }, data: { disabledAt: new Date() } });
    await tx.gatheringAdminSession.updateMany({
      where: { adminId: targetId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAdminAudit(tx, {
      actorAdminId: actorId,
      action: 'ADMIN_DISABLE',
      targetType: 'GatheringAdminAccount',
      targetId,
      before: { disabledAt: target.disabledAt?.toISOString() ?? null },
      after: { disabledAt: new Date().toISOString() },
      reason: reason.trim(),
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function listAdminAccounts(actorId: string) {
  const actor = await prisma.gatheringAdminAccount.findUnique({ where: { id: actorId } });
  if (!actor || !canManageAdminAccounts(actor.role, actor.disabledAt != null)) {
    throw new AppError(403, 'FORBIDDEN', '관리자 계정은 슈퍼관리자만 봅니다.');
  }
  const rows = await prisma.gatheringAdminAccount.findMany({
    orderBy: { createdAt: 'asc' },
    include: { scopes: true },
  });
  return rows.map((row) => ({
    id: row.id,
    loginId: row.loginId,
    role: row.role,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    totpReady: row.totpConfirmedAt != null,
    scopes: row.scopes.map((scope) => ({ groupId: scope.groupId, capability: scope.capability })),
  }));
}

export async function requireAdminSession(token: string | null, now = new Date()) {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  const session = await prisma.gatheringAdminSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { admin: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime() || session.admin.disabledAt) {
    throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  }
  return session;
}

export function assertAdminCsrf(csrfHash: string, header: string | string[] | undefined) {
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided || sha256(provided) !== csrfHash) {
    throw new AppError(403, 'CSRF', '요청을 확인할 수 없습니다.');
  }
}

async function openSession(adminId: string, userAgent: string | undefined, now: Date, action: string): Promise<SessionBody> {
  const account = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { id: adminId } });
  const issued = await prisma.$transaction(async (tx) => {
    await tx.gatheringAdminAccount.update({
      where: { id: adminId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const session = await issueSession(tx, adminId, userAgent, now);
    await writeAdminAudit(tx, {
      actorAdminId: adminId,
      action,
      targetType: 'GatheringAdminAccount',
      targetId: adminId,
    });
    return session;
  });
  return {
    ...issued,
    admin: { id: account.id, loginId: account.loginId, role: account.role },
  };
}

async function issueSession(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  adminId: string,
  userAgent: string | undefined,
  now: Date,
) {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = sessionExpiry(now);
  await tx.gatheringAdminSession.create({
    data: {
      adminId,
      tokenHash: sha256(token),
      csrfHash: sha256(csrfToken),
      expiresAt,
      userAgent: userAgent ?? null,
    },
  });
  return { token, csrfToken, expiresAt: expiresAt.toISOString() };
}

async function issueEnrollment(adminId: string, now: Date) {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + ADMIN_ENROLLMENT_MS);
  await prisma.gatheringAdminEnrollment.create({
    data: { adminId, tokenHash: sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

async function requireEnrollment(token: string, now: Date) {
  const row = await prisma.gatheringAdminEnrollment.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(401, 'ENROLLMENT_EXPIRED', '인증 앱 등록 시간이 지났습니다. 다시 로그인하세요.');
  }
  return row;
}

async function recordFailure(adminId: string, now: Date) {
  const current = await prisma.gatheringAdminAccount.findUnique({ where: { id: adminId } });
  if (!current) return;
  const failedAttempts = current.failedAttempts + 1;
  await prisma.gatheringAdminAccount.update({
    where: { id: adminId },
    data: { failedAttempts, lockedUntil: adminLockUntil(failedAttempts, now) },
  });
}

function normalizeLogin(loginId: string) {
  const value = loginId.trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(value)) {
    throw new AppError(400, 'INVALID_LOGIN', '아이디는 3자 이상의 영문, 숫자, ., _, - 만 됩니다.');
  }
  return value;
}

function isUnique(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
