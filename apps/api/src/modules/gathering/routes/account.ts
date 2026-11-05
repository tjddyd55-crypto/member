import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { gatheringAccountDeleteSchema, gatheringBlockSchema } from '@member/contracts';
import { deleteGatheringAccount } from '../account/delete-account.js';
import {
  blockMember,
  listOpenReports,
  moderateMembership,
  resolveReportAsOperator,
  suspendMemberAsOperator,
  unblockMember,
} from '../moderation/blocks.js';
import { requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const blockParams = z.object({ groupId: z.string().min(1), userId: z.string().min(1) });
const memberParams = z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) });
const reportParams = z.object({ reportId: z.string().min(1) });
const membershipParams = z.object({ membershipId: z.string().min(1) });
const resolveSchema = z.object({ status: z.enum(['RESOLVED', 'DISMISSED', 'REVIEWING']) });

export const gatheringAccountRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.post('/api/gathering/auth/account/delete', auth, async (request) => {
    const body = gatheringAccountDeleteSchema.parse(request.body);
    return deleteGatheringAccount(requireGatheringUserId(request), body.password);
  });

  app.post('/api/gathering/groups/:groupId/blocks', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringBlockSchema.parse(request.body);
    return blockMember(requireGatheringUserId(request), params.groupId, body.userId);
  });

  app.delete('/api/gathering/groups/:groupId/blocks/:userId', auth, async (request) => {
    const params = blockParams.parse(request.params);
    return unblockMember(requireGatheringUserId(request), params.groupId, params.userId);
  });

  app.post('/api/gathering/groups/:groupId/members/:membershipId/suspend', auth, async (request) => {
    const params = memberParams.parse(request.params);
    return moderateMembership(requireGatheringUserId(request), params.groupId, params.membershipId);
  });

  app.get('/api/gathering/admin/reports', auth, async (request) => {
    return listOpenReports(requireGatheringUserId(request), request.headers['x-gathering-operator-secret']);
  });

  app.post('/api/gathering/admin/reports/:reportId/resolve', auth, async (request) => {
    const params = reportParams.parse(request.params);
    const body = resolveSchema.parse(request.body);
    return resolveReportAsOperator(
      requireGatheringUserId(request),
      request.headers['x-gathering-operator-secret'],
      params.reportId,
      body.status,
    );
  });

  app.post('/api/gathering/admin/memberships/:membershipId/suspend', auth, async (request) => {
    const params = membershipParams.parse(request.params);
    return suspendMemberAsOperator(
      requireGatheringUserId(request),
      request.headers['x-gathering-operator-secret'],
      params.membershipId,
    );
  });
};
