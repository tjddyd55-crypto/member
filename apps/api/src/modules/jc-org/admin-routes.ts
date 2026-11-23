import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  adminDistricts,
  adminLocals,
  adminOrgHistory,
  adminReview,
  changeAdminLocalAlias,
  districtCreate,
  districtPatch,
  localCreate,
  localFilters,
  localPatch,
  moveAdminLocal,
  saveAdminOrg,
  setAdminOrgStatus,
} from './admin.js';
import { assertAdminCsrf, requireAdminSession } from '../gathering/admin/service.js';

const prefix = '/api/gathering-admin/jc-orgs';
const id = z.object({ id: z.string().cuid() });
const target = id.extend({
  type: z
    .enum(['districts', 'locals', 'district', 'local', 'DISTRICT', 'LOCAL'])
    .transform((value) =>
      value.toLowerCase().startsWith('local') ? ('LOCAL' as const) : ('DISTRICT' as const),
    ),
});
const note = z.string().trim().max(500).optional();

export function registerJcOrgAdminRoutes(
  app: FastifyInstance,
  readCookie: (request: FastifyRequest) => string | null,
) {
  async function authorize(request: FastifyRequest, mutation = false) {
    const session = await requireAdminSession(readCookie(request));
    if (session.admin.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'JC 조직은 슈퍼관리자만 관리할 수 있습니다.');
    }
    if (mutation) assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
    return session.admin;
  }

  app.get(`${prefix}/districts`, async (request) => {
    await authorize(request);
    return { items: await adminDistricts() };
  });
  app.post(`${prefix}/districts`, async (request, reply) => {
    const actor = await authorize(request, true);
    const district = await saveAdminOrg(actor, 'DISTRICT', districtCreate.parse(request.body));
    return reply.code(201).send({ district });
  });
  app.patch(`${prefix}/districts/:id`, async (request) => {
    const actor = await authorize(request, true);
    const district = await saveAdminOrg(
      actor,
      'DISTRICT',
      districtPatch.parse(request.body),
      id.parse(request.params).id,
    );
    return { district };
  });

  app.get(`${prefix}/locals`, async (request) => {
    await authorize(request);
    return { items: await adminLocals(localFilters.parse(request.query)) };
  });
  app.post(`${prefix}/locals`, async (request, reply) => {
    const actor = await authorize(request, true);
    const local = await saveAdminOrg(actor, 'LOCAL', localCreate.parse(request.body));
    return reply.code(201).send({ local });
  });
  app.patch(`${prefix}/locals/:id`, async (request) => {
    const actor = await authorize(request, true);
    const local = await saveAdminOrg(
      actor,
      'LOCAL',
      localPatch.parse(request.body),
      id.parse(request.params).id,
    );
    return { local };
  });
  app.post(`${prefix}/locals/:id/parent`, async (request) => {
    const actor = await authorize(request, true);
    const body = z.object({ districtId: z.string().cuid(), note }).parse(request.body);
    return {
      local: await moveAdminLocal(actor, id.parse(request.params).id, body.districtId, body.note),
    };
  });

  app.post(`${prefix}/:type/:id/status`, async (request) => {
    const actor = await authorize(request, true);
    const params = target.parse(request.params);
    const body = z.object({ active: z.boolean(), note }).parse(request.body);
    return { org: await setAdminOrgStatus(actor, params.type, params.id, body.active, body.note) };
  });
  app.get(`${prefix}/:type/:id/history`, async (request) => {
    await authorize(request);
    const params = target.parse(request.params);
    return { items: await adminOrgHistory(params.type, params.id) };
  });
  app.get(`${prefix}/review`, async (request) => {
    await authorize(request);
    return { items: await adminReview() };
  });

  for (const method of ['POST', 'DELETE'] as const) {
    app.route({
      method,
      url: `${prefix}/locals/:id/aliases`,
      async handler(request) {
        const actor = await authorize(request, true);
        const { alias } = z
          .object({ alias: z.string().trim().min(1).max(120) })
          .parse(request.body);
        return {
          local: await changeAdminLocalAlias(
            actor,
            id.parse(request.params).id,
            alias,
            method === 'DELETE',
          ),
        };
      },
    });
  }
}
