import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { authFromPayload, verifyAccessToken } from '../services/auth-service.js';
import type { MembershipRole, MembershipStatus } from '@prisma/client';

async function authPluginImpl(app: import('fastify').FastifyInstance) {
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyAccessToken(token);
    request.auth = authFromPayload(payload);
  });
}

export const authPlugin = fp(authPluginImpl);

export async function requireActiveMembership(request: FastifyRequest) {
  if (!request.auth) {
    throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  }
  if (request.auth.membershipStatus === 'PENDING') {
    throw new AppError(403, 'MEMBERSHIP_PENDING', '가입 승인 대기 중입니다.');
  }
  if (request.auth.membershipStatus !== 'ACTIVE') {
    throw new AppError(403, 'MEMBERSHIP_BLOCKED', '멤버십을 사용할 수 없습니다.');
  }
}

export function requireRoles(...roles: MembershipRole[]) {
  return async (request: FastifyRequest) => {
    await requireActiveMembership(request);
    if (!request.auth || !roles.includes(request.auth.role)) {
      throw new AppError(403, 'FORBIDDEN', '권한이 없습니다.');
    }
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export type { MembershipStatus };
