import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  acceptHandover,
  cancelHandover,
  confirmHandover,
  finalizeHandover,
  nominateHandover,
  readHandover,
} from '../handover/commands.js';
import { requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const handoverParams = z.object({ groupId: z.string().min(1), handoverId: z.string().min(1) });
const nominateSchema = z.object({
  toUserId: z.string().min(1),
  idempotencyKey: z.string().trim().min(8).max(80),
});
const confirmSchema = z.object({
  incomeWon: z.number().int(),
  expenseWon: z.number().int(),
  balanceWon: z.number().int(),
  dueCount: z.number().int().nonnegative(),
  receiptCount: z.number().int().nonnegative(),
});

export const gatheringHandoverRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.get('/api/gathering/groups/:groupId/handover', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return readHandover(requireGatheringUserId(request), params.groupId);
  });

  app.post('/api/gathering/groups/:groupId/handover', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = nominateSchema.parse(request.body);
    return nominateHandover(requireGatheringUserId(request), params.groupId, body);
  });

  app.post('/api/gathering/groups/:groupId/handover/:handoverId/accept', auth, async (request) => {
    const params = handoverParams.parse(request.params);
    return acceptHandover(requireGatheringUserId(request), params.groupId, params.handoverId);
  });

  app.post('/api/gathering/groups/:groupId/handover/:handoverId/confirm', auth, async (request) => {
    const params = handoverParams.parse(request.params);
    const body = confirmSchema.parse(request.body);
    return confirmHandover(requireGatheringUserId(request), params.groupId, params.handoverId, body);
  });

  app.post('/api/gathering/groups/:groupId/handover/:handoverId/finalize', auth, async (request) => {
    const params = handoverParams.parse(request.params);
    return finalizeHandover(requireGatheringUserId(request), params.groupId, params.handoverId);
  });

  app.post('/api/gathering/groups/:groupId/handover/:handoverId/cancel', auth, async (request) => {
    const params = handoverParams.parse(request.params);
    return cancelHandover(requireGatheringUserId(request), params.groupId, params.handoverId);
  });
};
