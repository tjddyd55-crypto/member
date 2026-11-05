import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../../lib/errors.js';
import { verifyGatheringAccessToken } from '../tokens.js';
import { gatheringAuthRoutes } from './auth.js';
import { gatheringGroupRoutes } from './groups.js';

export const gatheringRoutes: FastifyPluginAsync = async (app) => {
  app.decorate('authenticateGathering', async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
    }
    const token = header.slice('Bearer '.length);
    request.gatheringUserId = verifyGatheringAccessToken(token).userId;
  });

  await app.register(gatheringAuthRoutes);
  await app.register(gatheringGroupRoutes);
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticateGathering: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    gatheringUserId?: string;
  }
}
