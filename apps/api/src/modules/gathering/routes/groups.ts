import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  gatheringAcceptInviteSchema,
  gatheringGroupCreateSchema,
  gatheringGroupUpdateSchema,
  gatheringInviteCreateSchema,
  gatheringMemberQuerySchema,
  gatheringMembershipDecisionSchema,
  gatheringRoleAssignSchema,
} from '@member/contracts';
import { gatheringAuthLimiter } from '../rate-limit.js';
import { createGroup, updateGroup } from '../group-write.js';
import { getGroupDetail, listGroupMembers, listMyGroups } from '../group-read.js';
import { acceptGatheringInvite } from '../invite-accept.js';
import {
  createGatheringInvite,
  listGatheringInvites,
  previewGatheringInvite,
  revokeGatheringInvite,
} from '../invite-service.js';
import { decideMembership } from '../membership-service.js';
import { assignGatheringRole, revokeGatheringRole } from '../role-service.js';
import { limitGatheringAuth, requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const inviteParams = z.object({ groupId: z.string().min(1), inviteId: z.string().min(1) });
const roleParams = z.object({ groupId: z.string().min(1), assignmentId: z.string().min(1) });
const memberParams = z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) });
const tokenParams = z.object({ token: z.string().min(20) });
const listQuery = z.object({ q: z.string().optional(), groupId: z.string().optional() });

export const gatheringGroupRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.get('/api/gathering/groups', auth, async (request) => {
    const query = listQuery.parse(request.query);
    return { items: await listMyGroups(requireGatheringUserId(request), query.q) };
  });

  app.post('/api/gathering/groups', auth, async (request) => {
    const body = gatheringGroupCreateSchema.parse(request.body);
    return createGroup(requireGatheringUserId(request), body);
  });

  app.get('/api/gathering/groups/:groupId', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return getGroupDetail(requireGatheringUserId(request), params.groupId);
  });

  app.patch('/api/gathering/groups/:groupId', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringGroupUpdateSchema.parse(request.body);
    return updateGroup(requireGatheringUserId(request), params.groupId, body);
  });

  app.get('/api/gathering/groups/:groupId/members', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = gatheringMemberQuerySchema.parse(request.query);
    const items = await listGroupMembers(
      requireGatheringUserId(request),
      params.groupId,
      query.q,
      query.status ?? 'ACTIVE',
    );
    return { items };
  });

  app.post(
    '/api/gathering/groups/:groupId/members/:membershipId/decision',
    auth,
    async (request) => {
      const params = memberParams.parse(request.params);
      const body = gatheringMembershipDecisionSchema.parse(request.body);
      return decideMembership(
        requireGatheringUserId(request),
        params.groupId,
        params.membershipId,
        body.decision,
      );
    },
  );

  app.post('/api/gathering/groups/:groupId/roles', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringRoleAssignSchema.parse(request.body);
    return assignGatheringRole(requireGatheringUserId(request), params.groupId, body);
  });

  app.post('/api/gathering/groups/:groupId/roles/:assignmentId/revoke', auth, async (request) => {
    const params = roleParams.parse(request.params);
    return revokeGatheringRole(
      requireGatheringUserId(request),
      params.groupId,
      params.assignmentId,
    );
  });

  app.get('/api/gathering/groups/:groupId/invites', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return { items: await listGatheringInvites(requireGatheringUserId(request), params.groupId) };
  });

  app.post('/api/gathering/groups/:groupId/invites', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringInviteCreateSchema.parse(request.body);
    return createGatheringInvite(requireGatheringUserId(request), params.groupId, body);
  });

  app.post('/api/gathering/groups/:groupId/invites/:inviteId/revoke', auth, async (request) => {
    const params = inviteParams.parse(request.params);
    return revokeGatheringInvite(requireGatheringUserId(request), params.groupId, params.inviteId);
  });

  app.get('/api/gathering/invites/:token', async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const params = tokenParams.parse(request.params);
    return previewGatheringInvite(params.token);
  });

  app.post('/api/gathering/invites/:token/accept', auth, async (request) => {
    limitGatheringAuth(request, gatheringAuthLimiter);
    const params = tokenParams.parse(request.params);
    gatheringAcceptInviteSchema.parse(request.body);
    return acceptGatheringInvite(requireGatheringUserId(request), params.token);
  });
};
