import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ADMIN_CAPABILITIES, ADMIN_ROLES } from '@member/gathering-domain';
import { env } from '../../../config/env.js';
import { listAdminAudits, listAdminGroups, readAdminGroup } from './queries.js';
import {
  assertAdminCsrf,
  changeAdminPassword,
  confirmAdminTotp,
  createManagedAdmin,
  disableManagedAdmin,
  loginAdmin,
  logoutAdmin,
  requireAdminSession,
  startAdminTotp,
} from './service.js';

const COOKIE = 'gathering_admin_session';

const loginBody = z.object({
  loginId: z.string(),
  password: z.string(),
  totpCode: z.string().optional(),
});
const tokenBody = z.object({ enrollmentToken: z.string().min(1) });
const confirmBody = tokenBody.extend({ code: z.string() });
const passwordBody = z.object({ currentPassword: z.string(), nextPassword: z.string() });
const createBody = z.object({
  loginId: z.string(),
  password: z.string(),
  role: z.enum(ADMIN_ROLES),
  reason: z.string(),
  scopes: z.array(z.object({ groupId: z.string(), capability: z.enum(ADMIN_CAPABILITIES) })).default([]),
});
const disableBody = z.object({ reason: z.string() });

export const gatheringAdminRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/gathering-admin/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const result = await loginAdmin({ ...body, userAgent: request.headers['user-agent'] });
    if (result.kind === 'enrollment') {
      return { status: 'ENROLLMENT_REQUIRED', enrollmentToken: result.enrollmentToken, expiresAt: result.expiresAt };
    }
    setSessionCookie(reply, result.token, result.expiresAt);
    return { status: 'AUTHENTICATED', admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt };
  });

  app.post('/api/gathering-admin/auth/totp/start', async (request) => {
    const body = tokenBody.parse(request.body);
    return startAdminTotp(body.enrollmentToken);
  });

  app.post('/api/gathering-admin/auth/totp/confirm', async (request, reply) => {
    const body = confirmBody.parse(request.body);
    const result = await confirmAdminTotp(body.enrollmentToken, body.code, request.headers['user-agent']);
    setSessionCookie(reply, result.token, result.expiresAt);
    return { status: 'AUTHENTICATED', admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt };
  });

  app.post('/api/gathering-admin/auth/logout', async (request, reply) => {
    const session = await requireAdminSession(readCookie(request));
    assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
    await logoutAdmin(session.id, session.adminId);
    reply.header('set-cookie', clearCookie());
    return { ok: true };
  });

  app.post('/api/gathering-admin/auth/password', async (request, reply) => {
    const session = await requireAdminSession(readCookie(request));
    assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
    const body = passwordBody.parse(request.body);
    await changeAdminPassword(session.adminId, body.currentPassword, body.nextPassword);
    reply.header('set-cookie', clearCookie());
    return { ok: true };
  });

  app.get('/api/gathering-admin/me', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return { admin: { id: session.admin.id, loginId: session.admin.loginId, role: session.admin.role } };
  });

  app.get('/api/gathering-admin/groups', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return { items: await listAdminGroups(session.adminId) };
  });

  app.get('/api/gathering-admin/groups/:groupId', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    const params = z.object({ groupId: z.string() }).parse(request.params);
    return readAdminGroup(session.adminId, params.groupId);
  });

  app.get('/api/gathering-admin/audits', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return { items: await listAdminAudits(session.adminId) };
  });

  app.post('/api/gathering-admin/admins', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
    const body = createBody.parse(request.body);
    return createManagedAdmin(session.adminId, body);
  });

  app.post('/api/gathering-admin/admins/:adminId/disable', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
    const params = z.object({ adminId: z.string() }).parse(request.params);
    const body = disableBody.parse(request.body);
    await disableManagedAdmin(session.adminId, params.adminId, body.reason);
    return { ok: true };
  });
};

function readCookie(request: FastifyRequest) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/api/gathering-admin; SameSite=Lax; Max-Age=${maxAge}${secure()}`);
}

function clearCookie() {
  return `${COOKIE}=; HttpOnly; Path=/api/gathering-admin; SameSite=Lax; Max-Age=0${secure()}`;
}

function secure() {
  return env.NODE_ENV === 'production' ? '; Secure' : '';
}
