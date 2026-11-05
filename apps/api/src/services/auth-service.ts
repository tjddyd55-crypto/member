import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { MembershipRole, MembershipStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import type { AuthContext } from '../lib/local-scope.js';

export type AccessPayload = {
  sub: string;
  membershipId: string;
  localId: string;
  role: MembershipRole;
  membershipStatus: MembershipStatus;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function signAccessToken(payload: AccessPayload) {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    const raw = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof raw === 'string') {
      throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
    }
    if (raw.aud === 'gathering' || raw.typ === 'gathering_access') {
      throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
    }
    if (!raw.sub || !raw.membershipId || !raw.localId || !raw.role || !raw.membershipStatus) {
      throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
    }
    return {
      sub: raw.sub,
      membershipId: String(raw.membershipId),
      localId: String(raw.localId),
      role: raw.role as AccessPayload['role'],
      membershipStatus: raw.membershipStatus as AccessPayload['membershipStatus'],
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
  }
}

export async function issueSession(params: {
  userId: string;
  membershipId: string;
  localId: string;
  role: MembershipRole;
  membershipStatus: MembershipStatus;
  userAgent?: string;
}) {
  const accessToken = signAccessToken({
    sub: params.userId,
    membershipId: params.membershipId,
    localId: params.localId,
    role: params.role,
    membershipStatus: params.membershipStatus,
  });

  const refreshToken = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);

  await prisma.refreshSession.create({
    data: {
      userId: params.userId,
      membershipId: params.membershipId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: params.userAgent,
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}

export async function rotateRefreshToken(refreshToken: string, userAgent?: string) {
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: {
      membership: { include: { local: true } },
      user: true,
    },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'INVALID_REFRESH', '리프레시 토큰이 유효하지 않습니다.');
  }

  if (session.user.status !== 'ACTIVE') {
    throw new AppError(403, 'USER_BLOCKED', '사용할 수 없는 계정입니다.');
  }

  if (session.membership.status !== 'ACTIVE' && session.membership.status !== 'PENDING') {
    throw new AppError(403, 'MEMBERSHIP_BLOCKED', '멤버십 상태를 확인하세요.');
  }

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueSession({
    userId: session.userId,
    membershipId: session.membershipId,
    localId: session.membership.localId,
    role: session.membership.role,
    membershipStatus: session.membership.status,
    userAgent,
  });

  await prisma.refreshSession.update({
    where: { tokenHash: hashToken(tokens.refreshToken) },
    data: { replacedById: session.id },
  });

  return { tokens, membership: session.membership, user: session.user };
}

export async function revokeRefreshToken(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function loginWithPassword(
  identifier: string,
  password: string,
  membershipId?: string,
) {
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: identifier }, { email: identifier }],
    },
    include: {
      memberships: {
        include: {
          local: true,
          memberProfile: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError(403, 'USER_BLOCKED', '정지되었거나 사용할 수 없는 계정입니다.');
  }

  const candidates = user.memberships.filter((m) => ['ACTIVE', 'PENDING'].includes(m.status));

  if (candidates.length === 0) {
    throw new AppError(403, 'NO_MEMBERSHIP', '활성 멤버십이 없습니다.');
  }

  const membership =
    (membershipId ? candidates.find((m) => m.id === membershipId) : undefined) ??
    candidates.find((m) => m.status === 'ACTIVE') ??
    candidates[0];

  if (!membership) {
    throw new AppError(403, 'NO_MEMBERSHIP', '활성 멤버십이 없습니다.');
  }

  if (membership.status === 'SUSPENDED' || membership.status === 'WITHDRAWN') {
    throw new AppError(403, 'MEMBERSHIP_BLOCKED', '정지 또는 탈퇴된 멤버십입니다.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await issueSession({
    userId: user.id,
    membershipId: membership.id,
    localId: membership.localId,
    role: membership.role,
    membershipStatus: membership.status,
  });

  return { user, membership, tokens };
}

export function authFromPayload(payload: AccessPayload): AuthContext {
  return {
    userId: payload.sub,
    membershipId: payload.membershipId,
    localId: payload.localId,
    role: payload.role,
    membershipStatus: payload.membershipStatus,
  };
}
