import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/auth-service.js';

let app: FastifyInstance;
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];
const password = 'SecurityAdmin1!';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (adminIds.length > 0) {
    await prisma.gatheringAdminAudit.deleteMany({ where: { OR: [{ actorAdminId: { in: adminIds } }, { targetId: { in: adminIds } }] } });
    await prisma.gatheringAdminOperation.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringDeposit.updateMany({ where: { confirmedByAdminId: { in: adminIds } }, data: { confirmedByAdminId: null } });
    await prisma.gatheringSubscription.updateMany({ where: { approvedByAdminId: { in: adminIds } }, data: { approvedByAdminId: null } });
    await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminEnrollment.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  }
  if (groupIds.length > 0) {
    await prisma.gatheringDepositLink.deleteMany({ where: { deposit: { groupId: { in: groupIds } } } });
    await prisma.gatheringDeposit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  }
  if (userIds.length > 0) {
    await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe('관리자 보안과 기간 입력', () => {
  it('비밀번호 세션으로 회원 제한을 해도 장부는 남는다', async () => {
    const owner = await register('보안회장');
    const member = await register('일반회원');
    const group = await createGroup(owner.token);
    const membership = await prisma.gatheringMembership.create({
      data: { groupId: group.id, userId: member.userId, status: 'ACTIVE', joinedAt: new Date() },
    });
    const admin = await makeAdmin('security.root', 'SUPER_ADMIN');
    const session = await enroll(admin.loginId);

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: 'security.extra', password },
    });
    expect(firstLogin.statusCode).toBe(401);
    await makeAdmin('security.extra', 'ADMIN');
    const signed = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: 'security.extra', password, totpCode: '000000' },
    });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().status).toBe('AUTHENTICATED');
    expect(signed.json().enrollmentToken).toBeUndefined();

    const customEnd = '2027-01-15T00:00:00.000Z';
    const approved = await send(session, `/api/gathering-admin/groups/${group.id}/subscription`, {
      reason: '무상 기간',
      source: 'COMPLIMENTARY',
      startsAt: '2026-11-06T00:00:00.000Z',
      expiresAt: customEnd,
      idempotencyKey: 'custom-window-0001',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().expiresAt).toBe(customEnd);
    const beforeExpiry = approved.json().expiresAt;
    const odd = await send(session, `/api/gathering-admin/groups/${group.id}/deposits`, {
      payerName: '다른금액',
      amountWon: 1000,
      paidOn: '2026-11-06T00:00:00.000Z',
      idempotencyKey: 'odd-amount-0001',
    });
    const blocked = await send(session, `/api/gathering-admin/deposits/${odd.json().id}/confirm`, {
      reason: '불일치',
      idempotencyKey: 'odd-confirm-0001',
      subscriptionId: approved.json().id,
    });
    expect(blocked.statusCode).toBe(409);
    const linked = await send(session, `/api/gathering-admin/deposits/${odd.json().id}/confirm`, {
      reason: '예외 연결',
      idempotencyKey: 'odd-confirm-0002',
      subscriptionId: approved.json().id,
      allowMismatch: true,
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().subscriptionCount).toBe(await prisma.gatheringSubscription.count({ where: { groupId: group.id } }));
    const unchanged = await prisma.gatheringSubscription.findUniqueOrThrow({ where: { id: approved.json().id as string } });
    expect(unchanged.expiresAt?.toISOString()).toBe(beforeExpiry);

    const president = await prisma.gatheringMembership.findFirstOrThrow({ where: { groupId: group.id, userId: owner.userId } });
    const presidentBlock = await send(session, `/api/gathering-admin/groups/${group.id}/members/${president.id}/restriction`, {
      suspended: true,
      reason: '회장 제한',
      idempotencyKey: 'block-president-0001',
    });
    expect(presidentBlock.statusCode).toBe(200);
    expect(presidentBlock.json().status).toBe('SUSPENDED');
    expect(await prisma.gatheringRoleAssignment.count({ where: { membershipId: president.id, revokedAt: null, role: 'PRESIDENT' } })).toBe(1);
    expect(await prisma.gatheringHandover.count({ where: { groupId: group.id } })).toBe(0);
    const stillReads = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(stillReads.statusCode).toBe(403);
    const blockedWrite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { title: '제한 중', startsAt: '2026-12-01T00:00:00.000Z' },
    });
    expect(blockedWrite.statusCode).toBe(403);
    const restricted = await send(session, `/api/gathering-admin/groups/${group.id}/members/${membership.id}/restriction`, {
      suspended: true,
      reason: '운영 제한',
      idempotencyKey: 'block-member-0001',
    });
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json().status).toBe('SUSPENDED');
    expect(restricted.json().financeCount).toBe(0);
    expect(restricted.json().handoverCount).toBe(0);
    expect(await prisma.gatheringFinanceTransaction.count({ where: { groupId: group.id } })).toBe(0);
  });

  it('등록 여부와 상관없이 비밀번호만으로 세션이 생기고 저장된 비밀은 남는다', async () => {
    const freshId = `plain.${Date.now()}`;
    const fresh = await makeAdmin(freshId, 'SUPER_ADMIN');
    const freshLogin = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: freshId, password },
    });
    expect(freshLogin.statusCode).toBe(200);
    expect(freshLogin.json().status).toBe('AUTHENTICATED');
    expect(freshLogin.json().enrollmentToken).toBeUndefined();
    expect(JSON.stringify(freshLogin.json())).not.toContain(password);
    expect(String(freshLogin.headers['set-cookie'])).toContain('HttpOnly');
    expect(await prisma.gatheringAdminEnrollment.count({ where: { adminId: fresh.id } })).toBe(0);
    const freshRow = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(freshRow.totpSecretCipher).toBeNull();
    expect(freshRow.totpConfirmedAt).toBeNull();

    const enrolledId = `kept.${Date.now()}`;
    const enrolled = await makeAdmin(enrolledId, 'SUPER_ADMIN');
    const confirmedAt = new Date('2026-11-01T00:00:00.000Z');
    await prisma.gatheringAdminAccount.update({
      where: { id: enrolled.id },
      data: { totpSecretCipher: 'already-stored-cipher', totpConfirmedAt: confirmedAt },
    });
    const enrolledLogin = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: enrolledId, password },
    });
    expect(enrolledLogin.statusCode).toBe(200);
    expect(enrolledLogin.json().status).toBe('AUTHENTICATED');
    expect(JSON.stringify(enrolledLogin.json())).not.toContain('already-stored-cipher');
    const kept = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { id: enrolled.id } });
    expect(kept.totpSecretCipher).toBe('already-stored-cipher');
    expect(kept.totpConfirmedAt?.toISOString()).toBe(confirmedAt.toISOString());

    const gone = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/totp/start',
      payload: { enrollmentToken: 'unused' },
    });
    expect(gone.statusCode).toBe(404);
  });
});

async function makeAdmin(loginId: string, role: 'SUPER_ADMIN' | 'ADMIN') {
  const account = await prisma.gatheringAdminAccount.create({
    data: { loginId, passwordHash: await hashPassword(password), role },
  });
  adminIds.push(account.id);
  return account;
}

async function enroll(loginId: string) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/login',
    payload: { loginId, password },
  });
  expect(login.statusCode).toBe(200);
  expect(login.json().status).toBe('AUTHENTICATED');
  const raw = login.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  const cookie = String(line ?? '').split(';')[0] ?? '';
  return { cookie, csrf: login.json().csrfToken as string };
}

async function send(session: { cookie: string; csrf: string }, url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    headers: { cookie: session.cookie, 'x-gathering-admin-csrf': session.csrf },
    payload: payload as object,
  });
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
  return { token: res.json().tokens.accessToken as string, userId: res.json().user.id as string };
}

async function createGroup(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: '보안 모임' },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string };
}
