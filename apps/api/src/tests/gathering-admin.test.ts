import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_LOCK_THRESHOLD } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { bootstrapSuperAdmin } from '../modules/gathering/admin/bootstrap.js';
import { totpAt } from '../modules/gathering/admin/totp.js';

let app: FastifyInstance;
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];
const password = 'AdminPassw0rd!';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await wipeNamedAdmins();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

describe('슈퍼관리자 세션', () => {
  it('회원 토큰은 거부하고, TOTP를 확인한 서버 세션만 담당 모임을 본다', async () => {
    const owner = await register('관리회장');
    const first = await createGroup(owner.tokens.accessToken, '가 모임');
    const second = await createGroup(owner.tokens.accessToken, '나 모임');
    expect(await prisma.gatheringSubscription.count({ where: { groupId: { in: [first.id, second.id] }, source: 'TRIAL' } })).toBe(2);

    const memberAttempt = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/groups',
      headers: { authorization: `Bearer ${owner.tokens.accessToken}` },
    });
    expect(memberAttempt.statusCode).toBe(401);

    const created = await bootstrapSuperAdmin({ loginId: 'root.admin', password });
    expect(created.created).toBe(true);
    const root = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId: 'root.admin' } });
    adminIds.push(root.id);

    const enrolled = await enroll('root.admin', password);
    const me = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/me',
      headers: { cookie: enrolled.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().admin.role).toBe('SUPER_ADMIN');
    expect(JSON.stringify(me.json())).not.toContain(password);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/groups',
      headers: { cookie: enrolled.cookie },
    });
    expect(listed.statusCode).toBe(200);
    const names = listed.json().items.map((item: { name: string }) => item.name);
    expect(names).toEqual(expect.arrayContaining(['가 모임', '나 모임']));
    const detail = listed.json().items.find((item: { id: string }) => item.id === first.id);
    expect(detail.creator.phone).toBe(owner.phone);
    expect(detail.president.name).toBe('관리회장');
    expect(detail.subscription.source).toBe('TRIAL');

    const scoped = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/admins',
      headers: { cookie: enrolled.cookie, 'x-gathering-admin-csrf': me.json().csrfToken as string },
      payload: {
        loginId: 'local.admin',
        password,
        role: 'ADMIN',
        reason: '가 모임만 조회',
        scopes: [
          { groupId: first.id, capability: 'GROUP_READ' },
          { groupId: first.id, capability: 'AUDIT_READ' },
        ],
      },
    });
    expect(scoped.statusCode).toBe(200);
    const local = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId: 'local.admin' } });
    adminIds.push(local.id);
    const localSession = await enroll('local.admin', password);
    const visible = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/groups',
      headers: { cookie: localSession.cookie },
    });
    expect(visible.json().items.map((item: { id: string }) => item.id)).toEqual([first.id]);
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering-admin/groups/${second.id}`,
      headers: { cookie: localSession.cookie },
    });
    expect(hidden.statusCode).toBe(404);

    const audits = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/audits',
      headers: { cookie: enrolled.cookie },
    });
    expect(audits.statusCode).toBe(200);
    const auditText = JSON.stringify(audits.json());
    expect(auditText).not.toContain(password);
    expect(auditText).not.toContain('totp');
    expect(audits.json().items.some((item: { action: string }) => item.action === 'ADMIN_CREATE')).toBe(true);

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/logout',
      headers: { cookie: localSession.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    const disabled = await app.inject({
      method: 'POST',
      url: `/api/gathering-admin/admins/${local.id}/disable`,
      headers: { cookie: enrolled.cookie, 'x-gathering-admin-csrf': me.json().csrfToken as string },
      payload: { reason: '담당 종료' },
    });
    expect(disabled.statusCode).toBe(200);
    const afterDisable = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/me',
      headers: { cookie: localSession.cookie },
    });
    expect(afterDisable.statusCode).toBe(401);
    const last = await app.inject({
      method: 'POST',
      url: `/api/gathering-admin/admins/${root.id}/disable`,
      headers: { cookie: enrolled.cookie, 'x-gathering-admin-csrf': me.json().csrfToken as string },
      payload: { reason: '마지막 계정' },
    });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe('CANNOT_DISABLE_SELF');
  });

  it('비밀번호를 다섯 번 틀리면 잠그고 감사 로그에 비밀번호를 남기지 않는다', async () => {
    const { hashPassword } = await import('../services/auth-service.js');
    const account = await prisma.gatheringAdminAccount.create({
      data: { loginId: 'lock.admin', passwordHash: await hashPassword(password), role: 'ADMIN' },
    });
    adminIds.push(account.id);
    for (let attempt = 0; attempt < ADMIN_LOCK_THRESHOLD; attempt += 1) {
      const failed = await app.inject({
        method: 'POST',
        url: '/api/gathering-admin/auth/login',
        payload: { loginId: 'lock.admin', password: 'wrong-password' },
      });
      expect(failed.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: 'lock.admin', password },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('ADMIN_LOCKED');
    const rows = await prisma.gatheringAdminAudit.findMany({ where: { actorAdminId: account.id } });
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(JSON.stringify(rows)).not.toContain('wrong-password');
  });
});

async function enroll(loginId: string, secretPassword: string) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/login',
    payload: { loginId, password: secretPassword },
  });
  expect(login.statusCode).toBe(200);
  expect(login.json().status).toBe('ENROLLMENT_REQUIRED');
  expect(login.headers['set-cookie']).toBeUndefined();
  const started = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/totp/start',
    payload: { enrollmentToken: login.json().enrollmentToken },
  });
  expect(started.statusCode).toBe(200);
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/totp/confirm',
    payload: { enrollmentToken: login.json().enrollmentToken, code: totpAt(started.json().secret as string, Date.now()) },
  });
  expect(confirmed.statusCode).toBe(200);
  expect(JSON.stringify(confirmed.json())).not.toContain(started.json().secret as string);
  expect(JSON.stringify(confirmed.json())).not.toContain(secretPassword);
  return { cookie: cookieOf(confirmed), csrf: confirmed.json().csrfToken as string };
}

async function register(name: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: { name, phone, password: 'Passw0rd!', localJcName: '서울테스트', directoryConsent: true },
  });
  expect(res.statusCode).toBe(200);
  userIds.push(res.json().user.id);
  return { ...res.json(), phone } as { tokens: { accessToken: string }; user: { id: string }; phone: string };
}

async function createGroup(token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string };
}

function cookieOf(response: { headers: Record<string, string | string[] | undefined> }) {
  const raw = response.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  if (!line) throw new Error('세션 쿠키가 없습니다.');
  return line.split(';')[0] ?? '';
}

async function wipeNamedAdmins() {
  const names = ['root.admin', 'local.admin', 'lock.admin'];
  const rows = await prisma.gatheringAdminAccount.findMany({ where: { loginId: { in: names } }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.gatheringAdminAudit.deleteMany({ where: { OR: [{ actorAdminId: { in: ids } }, { targetId: { in: ids } }] } });
  await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: ids } } });
  await prisma.gatheringAdminEnrollment.deleteMany({ where: { adminId: { in: ids } } });
  await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: ids } } });
  await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: ids } } });
}

async function cleanup() {
  if (adminIds.length > 0) {
    await prisma.gatheringAdminAudit.deleteMany({ where: { actorAdminId: { in: adminIds } } });
    await prisma.gatheringAdminAudit.deleteMany({ where: { targetId: { in: adminIds } } });
    await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminEnrollment.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  }
  if (groupIds.length === 0) return;
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
