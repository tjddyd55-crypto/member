import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ADMIN_CAPABILITIES, ADMIN_ROLES } from '@member/gathering-domain';
import { env } from '../../../config/env.js';
import {
  adminDashboard,
  approveSubscription,
  cancelSubscription,
  confirmDeposit,
  listGroupDeposits,
  listScopedMembers,
  readBankSetting,
  recordDeposit,
  replaceAdminScopes,
  setGroupQuota,
  setGroupSuspension,
  setMemberRestriction,
  writeBankSetting,
} from './operations.js';
import { listAdminAudits, listAdminGroups, readAdminGroup } from './queries.js';
import {
  assertAdminCsrf,
  changeAdminPassword,
  confirmAdminTotp,
  createManagedAdmin,
  disableManagedAdmin,
  loginAdmin,
  listAdminAccounts,
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
    setSessionCookie(reply, result.token, result.expiresAt, result.csrfToken);
    return { status: 'AUTHENTICATED', admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt };
  });

  app.post('/api/gathering-admin/auth/totp/start', async (request) => {
    const body = tokenBody.parse(request.body);
    return startAdminTotp(body.enrollmentToken);
  });

  app.post('/api/gathering-admin/auth/totp/confirm', async (request, reply) => {
    const body = confirmBody.parse(request.body);
    const result = await confirmAdminTotp(body.enrollmentToken, body.code, request.headers['user-agent']);
    setSessionCookie(reply, result.token, result.expiresAt, result.csrfToken);
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
    return {
      admin: { id: session.admin.id, loginId: session.admin.loginId, role: session.admin.role },
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.get('/api/gathering-admin/admins', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return { items: await listAdminAccounts(session.adminId) };
  });

  app.get('/api/gathering-admin/dashboard', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return adminDashboard(session.adminId);
  });

  app.get('/api/gathering-admin/members', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    const query = z.object({ q: z.string().optional(), groupId: z.string().optional() }).parse(request.query);
    return { items: await listScopedMembers(session.adminId, query.q, query.groupId) };
  });

  app.get('/api/gathering-admin/groups', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    const query = z.object({
      q: z.string().optional(),
      status: z.enum(['all', 'trial', 'paid', 'complimentary', 'expired', 'suspended']).optional(),
      sort: z.enum(['created', 'expiry', 'name']).optional(),
    }).parse(request.query);
    let items = await listAdminGroups(session.adminId);
    const q = query.q?.trim().toLowerCase();
    if (q) items = items.filter((item) => item.name.toLowerCase().includes(q) || item.id.includes(q));
    if (query.status === 'suspended') items = items.filter((item) => item.suspended);
    if (query.status === 'trial') items = items.filter((item) => item.subscription.source === 'TRIAL' && item.subscription.status === 'ACTIVE');
    if (query.status === 'paid') items = items.filter((item) => item.subscription.source === 'PAID' && item.subscription.status === 'ACTIVE');
    if (query.status === 'complimentary') items = items.filter((item) => item.subscription.source === 'COMPLIMENTARY');
    if (query.status === 'expired') items = items.filter((item) => item.subscription.status !== 'ACTIVE');
    if (query.sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (query.sort === 'expiry') items.sort((a, b) => (a.subscription.expiresAt ?? '').localeCompare(b.subscription.expiresAt ?? ''));
    if (query.sort === 'created') items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items };
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

  app.post('/api/gathering-admin/groups/:groupId/suspension', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string() }).parse(request.params);
    const body = z.object({ suspended: z.boolean(), reason: z.string(), idempotencyKey: z.string().min(8) }).parse(request.body);
    return setGroupSuspension(session.adminId, params.groupId, body.suspended, body.reason, body.idempotencyKey);
  });

  app.post('/api/gathering-admin/groups/:groupId/subscription', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string() }).parse(request.params);
    const body = z.object({
      reason: z.string(),
      idempotencyKey: z.string().min(8),
      source: z.enum(['PAID', 'COMPLIMENTARY']).optional(),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
    }).parse(request.body);
    return approveSubscription(session.adminId, params.groupId, body);
  });

  app.post('/api/gathering-admin/groups/:groupId/subscription/cancel', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string(), idempotencyKey: z.string().min(8) }).parse(request.body);
    return cancelSubscription(session.adminId, params.groupId, body);
  });

  app.get('/api/gathering-admin/groups/:groupId/deposits', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    const params = z.object({ groupId: z.string() }).parse(request.params);
    return { items: await listGroupDeposits(session.adminId, params.groupId) };
  });

  app.post('/api/gathering-admin/groups/:groupId/deposits', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string() }).parse(request.params);
    const body = z.object({
      payerName: z.string().min(1),
      amountWon: z.number().int(),
      paidOn: z.string(),
      memo: z.string().optional(),
      idempotencyKey: z.string().min(8),
    }).parse(request.body);
    return recordDeposit(session.adminId, params.groupId, body);
  });

  app.post('/api/gathering-admin/deposits/:depositId/confirm', async (request) => {
    const session = await mutate(request);
    const params = z.object({ depositId: z.string() }).parse(request.params);
    const body = z.object({
      reason: z.string(),
      idempotencyKey: z.string().min(8),
      subscriptionId: z.string().optional(),
      allowMismatch: z.boolean().optional(),
    }).parse(request.body);
    return confirmDeposit(session.adminId, params.depositId, body);
  });

  app.post('/api/gathering-admin/groups/:groupId/members/:membershipId/restriction', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string(), membershipId: z.string() }).parse(request.params);
    const body = z.object({
      suspended: z.boolean(),
      reason: z.string(),
      idempotencyKey: z.string().min(8),
    }).parse(request.body);
    return setMemberRestriction(session.adminId, params.groupId, params.membershipId, body);
  });

  app.post('/api/gathering-admin/groups/:groupId/quota', async (request) => {
    const session = await mutate(request);
    const params = z.object({ groupId: z.string() }).parse(request.params);
    const body = z.object({
      quotaBytes: z.number().int(),
      reason: z.string(),
      idempotencyKey: z.string().min(8),
    }).parse(request.body);
    return setGroupQuota(session.adminId, params.groupId, body);
  });

  app.put('/api/gathering-admin/admins/:adminId/scopes', async (request) => {
    const session = await mutate(request);
    const params = z.object({ adminId: z.string() }).parse(request.params);
    const body = z.object({
      reason: z.string(),
      scopes: z.array(z.object({ groupId: z.string(), capability: z.enum(ADMIN_CAPABILITIES) })),
    }).parse(request.body);
    await replaceAdminScopes(session.adminId, params.adminId, body.scopes, body.reason);
    return { ok: true };
  });

  app.get('/api/gathering-admin/settings/bank', async (request) => {
    const session = await requireAdminSession(readCookie(request));
    return { setting: await readBankSetting(session.adminId) };
  });

  app.put('/api/gathering-admin/settings/bank', async (request) => {
    const session = await mutate(request);
    const body = z.object({
      bankName: z.string().min(1),
      accountNumber: z.string().min(1),
      holder: z.string().min(1),
      memo: z.string().optional(),
      reason: z.string(),
    }).parse(request.body);
    return writeBankSetting(session.adminId, body);
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

async function mutate(request: FastifyRequest) {
  const session = await requireAdminSession(readCookie(request));
  assertAdminCsrf(session.csrfHash, request.headers['x-gathering-admin-csrf']);
  return session;
}

function readCookie(request: FastifyRequest) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, csrfToken?: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const cookies = [`${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/api/gathering-admin; SameSite=Lax; Max-Age=${maxAge}${secure()}`];
  if (csrfToken) {
    cookies.push(`gathering_admin_csrf=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure()}`);
  }
  reply.header('set-cookie', cookies);
}

function clearCookie() {
  return `${COOKIE}=; HttpOnly; Path=/api/gathering-admin; SameSite=Lax; Max-Age=0${secure()}`;
}

function secure() {
  return env.NODE_ENV === 'production' ? '; Secure' : '';
}
