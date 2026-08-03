import type { FastifyPluginAsync } from 'fastify';
import { loginBodySchema, refreshBodySchema } from '@member/contracts';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import {
  loginWithPassword,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/auth-service.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/login', async (request) => {
    const body = loginBodySchema.parse(request.body);
    const result = await loginWithPassword(body.identifier, body.password, body.membershipId);
    return {
      tokens: result.tokens,
      user: {
        id: result.user.id,
        phone: result.user.phone,
        email: result.user.email,
        status: result.user.status,
      },
      membership: {
        id: result.membership.id,
        localId: result.membership.localId,
        role: result.membership.role,
        status: result.membership.status,
        local: {
          id: result.membership.local.id,
          name: result.membership.local.name,
          slogan: result.membership.local.slogan,
          primaryColor: result.membership.local.primaryColor,
        },
        memberProfile: result.membership.memberProfile
          ? {
              id: result.membership.memberProfile.id,
              name: result.membership.memberProfile.name,
              memberNumber: result.membership.memberProfile.memberNumber,
              currentPositionText: result.membership.memberProfile.currentPositionText,
            }
          : null,
      },
    };
  });

  app.post('/api/auth/refresh', async (request) => {
    const body = refreshBodySchema.parse(request.body);
    const result = await rotateRefreshToken(body.refreshToken, request.headers['user-agent']);
    return { tokens: result.tokens };
  });

  app.post('/api/auth/logout', async (request) => {
    const body = refreshBodySchema.partial().parse(request.body ?? {});
    if (body.refreshToken) {
      await revokeRefreshToken(body.refreshToken);
    }
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');

    const membership = await prisma.localMembership.findFirst({
      where: { id: request.auth.membershipId, userId: request.auth.userId },
      include: {
        local: true,
        memberProfile: true,
        user: true,
      },
    });

    if (!membership) {
      throw new AppError(401, 'UNAUTHORIZED', '멤버십을 찾을 수 없습니다.');
    }

    return {
      user: {
        id: membership.user.id,
        phone: membership.user.phone,
        email: membership.user.email,
        status: membership.user.status,
      },
      membership: {
        id: membership.id,
        localId: membership.localId,
        role: membership.role,
        status: membership.status,
        local: {
          id: membership.local.id,
          name: membership.local.name,
          slogan: membership.local.slogan,
          primaryColor: membership.local.primaryColor,
        },
        memberProfile: membership.memberProfile
          ? {
              id: membership.memberProfile.id,
              name: membership.memberProfile.name,
              memberNumber: membership.memberProfile.memberNumber,
              currentPositionText: membership.memberProfile.currentPositionText,
            }
          : null,
      },
    };
  });
};
