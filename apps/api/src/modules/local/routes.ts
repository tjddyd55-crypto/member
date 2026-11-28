import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireGatheringUserId } from '../gathering/http.js';
import { SlidingWindowLimiter } from '../gathering/rate-limit.js';
import { cancelLocalJoin, getLocalMe, requestLocalJoin } from './join-request.js';
import { localMemberGuard, localPermissionGuard } from './access.js';

type LocalRoute = { Params: { localId: string } };

async function ping(request: FastifyRequest<LocalRoute>) {
  const { localId, role } = request.localAccess!;
  return { ok: true, localId, role };
}

export const gatheringLocalRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest('localAccess', null);
  app.setChildLoggerFactory((logger, bindings, options) =>
    logger.child(bindings, {
      ...options,
      // Fastify's default request serializer logs the raw URL, including query values.
      serializers: { req: (request: FastifyRequest) => ({ method: request.method }) },
    }),
  );

  const auth = { preHandler: [app.authenticateGathering] };
  const joinLimiter = new SlidingWindowLimiter(30, 60_000);
  const emptyBody = z.object({}).strict().optional();

  app.get('/api/local/me', auth, (request) => getLocalMe(requireGatheringUserId(request)));

  app.post<LocalRoute>('/api/local/:localId/join-request', auth, async (request, reply) => {
    const userId = requireGatheringUserId(request);
    joinLimiter.assert(userId);
    emptyBody.parse(request.body);
    const { created, membership } = await requestLocalJoin(userId, request.params.localId);
    return reply.code(created ? 201 : 200).send({ membership });
  });

  app.delete<LocalRoute>('/api/local/:localId/join-request', auth, async (request) => {
    const userId = requireGatheringUserId(request);
    joinLimiter.assert(userId);
    return { membership: await cancelLocalJoin(userId, request.params.localId) };
  });

  app.get<LocalRoute>('/api/local/:localId/ping', {
    preHandler: [app.authenticateGathering, localMemberGuard],
  }, ping);
  app.get<LocalRoute>('/api/local/:localId/admin-ping', {
    preHandler: [app.authenticateGathering, localPermissionGuard('members.manage')],
  }, ping);
};
