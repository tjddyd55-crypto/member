import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
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

  app.get<LocalRoute>('/api/local/:localId/ping', {
    preHandler: [app.authenticateGathering, localMemberGuard],
  }, ping);
  app.get<LocalRoute>('/api/local/:localId/admin-ping', {
    preHandler: [app.authenticateGathering, localPermissionGuard('members.manage')],
  }, ping);
};
