import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  gatheringAttendanceSchema,
  gatheringEventUpdateSchema,
  gatheringEventWriteSchema,
  gatheringPushSchema,
  gatheringRangeQuerySchema,
  gatheringRoleAssignSchema,
} from '@member/contracts';
import { AppError } from '../../../lib/errors.js';
import {
  createGatheringEvent,
  getGatheringEvent,
  listGroupEvents,
  listMyEvents,
  setEventAttendance,
  updateGatheringEvent,
} from '../events/service.js';
import { listGatheringOfficers } from '../officers/service.js';
import { dispatchEventReminders, registerGatheringPush } from '../push/service.js';
import { assignGatheringRole, revokeGatheringRole } from '../role-service.js';
import { requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const eventParams = z.object({ groupId: z.string().min(1), eventId: z.string().min(1) });
const roleParams = z.object({ groupId: z.string().min(1), assignmentId: z.string().min(1) });
const TEST_JOB_SECRET = 'test-job-secret-not-for-prod';

export const gatheringScheduleRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.get('/api/gathering/calendar', auth, async (request) => {
    const query = gatheringRangeQuerySchema.parse(request.query);
    const items = await listMyEvents(requireGatheringUserId(request), new Date(query.from), new Date(query.to));
    return { items };
  });

  app.get('/api/gathering/groups/:groupId/events', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = gatheringRangeQuerySchema.parse(request.query);
    const items = await listGroupEvents(
      requireGatheringUserId(request),
      params.groupId,
      new Date(query.from),
      new Date(query.to),
      { order: query.order, status: query.status },
    );
    return { items };
  });

  app.post('/api/gathering/groups/:groupId/events', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringEventWriteSchema.parse(request.body);
    return createGatheringEvent(requireGatheringUserId(request), params.groupId, body);
  });

  app.get('/api/gathering/groups/:groupId/events/:eventId', auth, async (request) => {
    const params = eventParams.parse(request.params);
    return getGatheringEvent(requireGatheringUserId(request), params.groupId, params.eventId);
  });

  app.patch('/api/gathering/groups/:groupId/events/:eventId', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = gatheringEventUpdateSchema.parse(request.body);
    return updateGatheringEvent(requireGatheringUserId(request), params.groupId, params.eventId, body);
  });

  app.put('/api/gathering/groups/:groupId/events/:eventId/attendance', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = gatheringAttendanceSchema.parse(request.body);
    return setEventAttendance(requireGatheringUserId(request), params.groupId, params.eventId, body.status);
  });

  app.get('/api/gathering/groups/:groupId/officers', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return listGatheringOfficers(requireGatheringUserId(request), params.groupId);
  });

  app.post('/api/gathering/groups/:groupId/officers', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringRoleAssignSchema.parse(request.body);
    return assignGatheringRole(requireGatheringUserId(request), params.groupId, body);
  });

  app.post('/api/gathering/groups/:groupId/officers/:assignmentId/revoke', auth, async (request) => {
    const params = roleParams.parse(request.params);
    return revokeGatheringRole(requireGatheringUserId(request), params.groupId, params.assignmentId);
  });

  app.post('/api/gathering/push/tokens', auth, async (request) => {
    const body = gatheringPushSchema.parse(request.body);
    return registerGatheringPush(requireGatheringUserId(request), body);
  });

  app.post('/api/gathering/jobs/reminders', async (request) => {
    assertGatheringJobSecret(request.headers['x-gathering-job-secret']);
    return { dispatched: await dispatchEventReminders(new Date()) };
  });
};

export function currentJobSecret() {
  if (process.env.GATHERING_JOB_SECRET) return process.env.GATHERING_JOB_SECRET;
  if (process.env.NODE_ENV === 'test') return TEST_JOB_SECRET;
  return '';
}

export function assertGatheringJobSecret(header: string | string[] | undefined) {
  const expected = currentJobSecret();
  const provided = Array.isArray(header) ? header[0] : header;
  if (!expected || !provided || !safeEqual(provided, expected)) {
    throw new AppError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다.');
  }
}

function safeEqual(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
