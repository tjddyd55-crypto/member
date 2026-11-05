import type { FastifyPluginAsync } from 'fastify';
import {
  gatheringLoginSchema,
  gatheringLogoutSchema,
  gatheringProfileSchema,
  gatheringRecoveryRedeemSchema,
  gatheringRecoveryRequestSchema,
  gatheringRefreshSchema,
  gatheringRegisterSchema,
} from '@member/contracts';
import { gatheringAuthLimiter } from '../rate-limit.js';
import {
  completeGatheringProfile,
  loginGatheringAccount,
  registerGatheringAccount,
} from '../auth-service.js';
import {
  getGatheringMe,
  logoutGatheringSession,
  redeemGatheringRecovery,
  refreshGatheringSession,
  requestGatheringRecovery,
} from '../recovery-service.js';
import { limitGatheringAuth, readUserAgent, requireGatheringUserId } from '../http.js';

export const gatheringAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/gathering/auth/register', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const body = gatheringRegisterSchema.parse(request.body);
    return registerGatheringAccount({ ...body, userAgent: readUserAgent(request) });
  });

  app.post('/api/gathering/auth/login', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const body = gatheringLoginSchema.parse(request.body);
    return loginGatheringAccount(body.phone, body.password, readUserAgent(request));
  });

  app.post('/api/gathering/auth/refresh', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const body = gatheringRefreshSchema.parse(request.body);
    return refreshGatheringSession(body.refreshToken, readUserAgent(request));
  });

  app.post('/api/gathering/auth/logout', async (request) => {
    const body = gatheringLogoutSchema.parse(request.body ?? {});
    return logoutGatheringSession(body.refreshToken);
  });

  app.get(
    '/api/gathering/auth/me',
    { preHandler: [app.authenticateGathering] },
    async (request) => {
      return getGatheringMe(requireGatheringUserId(request));
    },
  );

  app.post(
    '/api/gathering/auth/profile',
    { preHandler: [app.authenticateGathering] },
    async (request) => {
      const body = gatheringProfileSchema.parse(request.body);
      return completeGatheringProfile(requireGatheringUserId(request), body);
    },
  );

  app.post('/api/gathering/auth/recovery/redeem', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const body = gatheringRecoveryRedeemSchema.parse(request.body);
    return redeemGatheringRecovery(body);
  });

  app.post('/api/gathering/auth/recovery/request', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const body = gatheringRecoveryRequestSchema.parse(request.body);
    return requestGatheringRecovery(body);
  });
};
