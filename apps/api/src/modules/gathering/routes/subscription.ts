import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { assertGatheringJobSecret } from './schedule.js';
import { assertOperatorSecret, dispatchSubscriptionNotices, grantSubscription, readSubscription } from '../subscription/service.js';
import { requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const grantSchema = z.object({
  source: z.enum(['PAID', 'COMPLIMENTARY']),
  idempotencyKey: z.string().trim().min(8).max(80),
  note: z.string().trim().max(500).optional(),
  startsAt: z.string().datetime().optional(),
});

export const gatheringSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.get('/api/gathering/groups/:groupId/subscription', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return readSubscription(requireGatheringUserId(request), params.groupId);
  });

  app.post('/api/gathering/admin/groups/:groupId/subscription', auth, async (request) => {
    assertOperatorSecret(request.headers['x-gathering-operator-secret']);
    const params = groupParams.parse(request.params);
    const body = grantSchema.parse(request.body);
    return grantSubscription(requireGatheringUserId(request), params.groupId, body);
  });

  app.post('/api/gathering/jobs/subscription-notices', async (request) => {
    assertGatheringJobSecret(request.headers['x-gathering-job-secret']);
    return dispatchSubscriptionNotices(new Date());
  });
};
