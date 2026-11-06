import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FORMAL_ANNUAL_FEE_WON } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { bootstrapSuperAdmin } from '../modules/gathering/admin/bootstrap.js';
import { totpAt } from '../modules/gathering/admin/totp.js';

let app: FastifyInstance;
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];
const password = 'OpsAdminPass1!';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

describe('관리자 운영 API', () => {
  it('실데이터 집계, 범위, 이용권, 입금, 정지, 용량을 서버에서 처리한다', async () => {
    const owner = await register('운영회장');
    const first = await createGroup(owner.token, '첫째 모임');
    const second = await createGroup(owner.token, '둘째 모임');
    expect(await prisma.gatheringSubscription.count({ where: { groupId: { in: [first.id, second.id] }, source: 'TRIAL' } })).toBe(2);
    const creatorBefore = (await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: first.id } })).createdByUserId;

    await bootstrapSuperAdmin({ loginId: 'ops.root', password });
    const root = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId: 'ops.root' } });
    adminIds.push(root.id);
    const session = await enroll('ops.root');

    const dash = await app.inject({ method: 'GET', url: '/api/gathering-admin/dashboard', headers: { cookie: session.cookie } });
    expect(dash.statusCode).toBe(200);
    expect(dash.json().groupCount).toBeGreaterThanOrEqual(2);
    expect(dash.json().activeTrials).toBeGreaterThanOrEqual(2);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/gathering-admin/groups/${first.id}`,
      headers: { cookie: session.cookie },
    });
    expect(detail.json().creator.id).toBe(creatorBefore);
    expect(detail.json().creator.phone).toBe(owner.phone);
    expect(detail.json().president.id).toBe(creatorBefore);

    const createdAdmin = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/admins',
      headers: { cookie: session.cookie, 'x-gathering-admin-csrf': session.csrf },
      payload: {
        loginId: 'ops.local',
        password,
        role: 'ADMIN',
        reason: '첫째 모임 조회',
        scopes: [
          { groupId: first.id, capability: 'GROUP_READ' },
          { groupId: first.id, capability: 'MEMBER_READ' },
          { groupId: first.id, capability: 'SUBSCRIPTION_WRITE' },
          { groupId: first.id, capability: 'PAYMENT_WRITE' },
          { groupId: first.id, capability: 'QUOTA_WRITE' },
        ],
      },
    });
    expect(createdAdmin.statusCode).toBe(200);
    const local = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId: 'ops.local' } });
    adminIds.push(local.id);
    const localSession = await enroll('ops.local');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering-admin/groups/${second.id}`,
      headers: { cookie: localSession.cookie },
    });
    expect(hidden.statusCode).toBe(404);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/groups',
      headers: { cookie: localSession.cookie },
    });
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].creator.phone).toBeNull();
    const members = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/members',
      headers: { cookie: localSession.cookie },
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().items[0].user.phone).toBeNull();
    const scopeDenied = await app.inject({
      method: 'PUT',
      url: `/api/gathering-admin/admins/${local.id}/scopes`,
      headers: { cookie: localSession.cookie, 'x-gathering-admin-csrf': localSession.csrf },
      payload: { reason: '확대', scopes: [{ groupId: second.id, capability: 'GROUP_READ' }] },
    });
    expect(scopeDenied.statusCode).toBe(403);

    const suspended = await send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/suspension`, {
      suspended: true,
      reason: '회비 미납',
      idempotencyKey: 'suspend-first-0001',
    });
    expect(suspended.statusCode).toBe(200);
    const [one, two] = await Promise.all([
      send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/subscription`, {
        reason: '정식 승인',
        idempotencyKey: 'approve-first-0001',
      }),
      send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/subscription`, {
        reason: '정식 승인',
        idempotencyKey: 'approve-first-0001',
      }),
    ]);
    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);
    expect(one.json().id).toBe(two.json().id);
    expect(one.json().suspended).toBe(true);
    expect(one.json().createdByUserId).toBe(creatorBefore);
    const still = await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: first.id } });
    expect(still.suspendedAt).not.toBeNull();
    expect(still.createdByUserId).toBe(creatorBefore);
    expect(await prisma.gatheringSubscription.count({ where: { groupId: first.id, source: 'PAID' } })).toBe(1);

    const odd = await send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/deposits`, {
      payerName: '홍길동',
      amountWon: 1000,
      paidOn: '2026-11-06T00:00:00.000Z',
      idempotencyKey: 'deposit-odd-0001',
    });
    expect(odd.statusCode).toBe(200);
    const beforeCount = await prisma.gatheringSubscription.count({ where: { groupId: first.id } });
    const mismatched = await send(localSession, 'POST', `/api/gathering-admin/deposits/${odd.json().id}/confirm`, {
      reason: '금액 불일치',
      idempotencyKey: 'confirm-odd-0001',
      subscriptionId: one.json().id,
    });
    expect(mismatched.statusCode).toBe(409);
    expect(await prisma.gatheringSubscription.count({ where: { groupId: first.id } })).toBe(beforeCount);

    const paid = await send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/deposits`, {
      payerName: '홍길동',
      amountWon: FORMAL_ANNUAL_FEE_WON,
      paidOn: '2026-11-06T00:00:00.000Z',
      idempotencyKey: 'deposit-paid-0001',
    });
    const linked = await send(localSession, 'POST', `/api/gathering-admin/deposits/${paid.json().id}/confirm`, {
      reason: '은행 확인',
      idempotencyKey: 'confirm-paid-0001',
      subscriptionId: one.json().id,
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().linked).toBe(true);
    expect(linked.json().subscriptionCount).toBe(beforeCount);

    await prisma.gatheringMediaAsset.create({
      data: {
        groupId: first.id,
        uploaderUserId: owner.userId,
        kind: 'PHOTO',
        storageKey: `test/${first.id}/keep`,
        mimeType: 'image/jpeg',
        sizeBytes: 100n,
        status: 'READY',
      },
    });
    const quota = await send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/quota`, {
      quotaBytes: 10,
      reason: '한도 축소',
      idempotencyKey: 'quota-first-0001',
    });
    expect(quota.statusCode).toBe(200);
    expect(quota.json().mediaCount).toBe(1);
    expect(await prisma.gatheringMediaAsset.count({ where: { groupId: first.id, deletedAt: null } })).toBe(1);

    const otherWrite = await send(localSession, 'POST', `/api/gathering-admin/groups/${second.id}/subscription/cancel`, {
      reason: '다른 모임',
      idempotencyKey: 'cancel-second-0001',
    });
    expect(otherWrite.statusCode).toBe(404);

    const bankDenied = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/settings/bank',
      headers: { cookie: localSession.cookie },
    });
    expect(bankDenied.statusCode).toBe(403);
    const bank = await app.inject({
      method: 'PUT',
      url: '/api/gathering-admin/settings/bank',
      headers: { cookie: session.cookie, 'x-gathering-admin-csrf': session.csrf },
      payload: { bankName: '테스트은행', accountNumber: '110-000', holder: '제이씨아이', reason: '내부 기록' },
    });
    expect(bank.statusCode).toBe(200);
    const memberView = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${first.id}/subscription`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(JSON.stringify(memberView.json())).not.toContain('110-000');

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/logout',
      headers: { cookie: localSession.cookie, 'x-gathering-admin-csrf': localSession.csrf },
    });
    expect(loggedOut.statusCode).toBe(200);
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/me',
      headers: { cookie: localSession.cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('등록 토큰은 한 번만 세션이 되고 비밀번호를 바꾸면 이전 세션이 죽는다', async () => {
    const { hashPassword } = await import('../services/auth-service.js');
    const account = await prisma.gatheringAdminAccount.create({
      data: { loginId: 'ops.once', passwordHash: await hashPassword(password), role: 'ADMIN' },
    });
    adminIds.push(account.id);
    const login = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/login',
      payload: { loginId: 'ops.once', password },
    });
    const started = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/totp/start',
      payload: { enrollmentToken: login.json().enrollmentToken },
    });
    const code = totpAt(started.json().secret as string, Date.now());
    const first = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/totp/confirm',
      payload: { enrollmentToken: login.json().enrollmentToken, code },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/totp/confirm',
      payload: { enrollmentToken: login.json().enrollmentToken, code },
    });
    expect(second.statusCode).toBe(401);
    const cookie = cookieOf(first);
    const changed = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/auth/password',
      headers: { cookie, 'x-gathering-admin-csrf': first.json().csrfToken },
      payload: { currentPassword: password, nextPassword: 'OpsAdminPass2!' },
    });
    expect(changed.statusCode).toBe(200);
    const stale = await app.inject({ method: 'GET', url: '/api/gathering-admin/me', headers: { cookie } });
    expect(stale.statusCode).toBe(401);
    const cipher = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(cipher.totpSecretCipher).not.toContain(started.json().secret as string);
  });

  it('연락처와 감사는 그 모임의 권한으로만 보여 준다', async () => {
    const owner = await register('권한회장');
    const first = await createGroup(owner.token, '연락 있는 모임');
    const second = await createGroup(owner.token, '연락 없는 모임');
    const { hashPassword } = await import('../services/auth-service.js');
    const loginId = `scope.root.${Date.now()}`;
    const root = await prisma.gatheringAdminAccount.create({
      data: { loginId, passwordHash: await hashPassword(password), role: 'SUPER_ADMIN' },
    });
    adminIds.push(root.id);
    const session = await enroll(loginId);
    const localLogin = `scope.local.${Date.now()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/admins',
      headers: { cookie: session.cookie, 'x-gathering-admin-csrf': session.csrf },
      payload: {
        loginId: localLogin,
        password,
        role: 'ADMIN',
        reason: '범위 분리',
        scopes: [
          { groupId: first.id, capability: 'MEMBER_READ' },
          { groupId: second.id, capability: 'MEMBER_READ' },
          { groupId: first.id, capability: 'CONTACT_READ' },
          { groupId: first.id, capability: 'AUDIT_READ' },
          { groupId: first.id, capability: 'SUBSCRIPTION_WRITE' },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const local = await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId: localLogin } });
    adminIds.push(local.id);
    const localSession = await enroll(localLogin);
    await send(session, 'POST', `/api/gathering-admin/groups/${second.id}/subscription`, {
      reason: '둘째 정식',
      idempotencyKey: `scope-second-${second.id}`,
    });
    await send(localSession, 'POST', `/api/gathering-admin/groups/${first.id}/subscription`, {
      reason: '첫째 정식',
      idempotencyKey: `scope-first-${first.id}`,
    });

    const members = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/members',
      headers: { cookie: localSession.cookie },
    });
    expect(members.statusCode).toBe(200);
    const rows = members.json().items as Array<{ group: { id: string }; user: { phone: string | null } }>;
    expect(rows.find((row) => row.group.id === first.id)?.user.phone).toBe(owner.phone);
    expect(rows.find((row) => row.group.id === second.id)?.user.phone).toBeNull();
    const hiddenGroup = await app.inject({
      method: 'GET',
      url: `/api/gathering-admin/members?groupId=${second.id}`,
      headers: { cookie: localSession.cookie },
    });
    expect(hiddenGroup.json().items[0].user.phone).toBeNull();
    const byPhone = await app.inject({
      method: 'GET',
      url: `/api/gathering-admin/members?q=${encodeURIComponent(owner.phone)}`,
      headers: { cookie: localSession.cookie },
    });
    const phoneRows = byPhone.json().items as Array<{ group: { id: string } }>;
    expect(phoneRows.some((row) => row.group.id === second.id)).toBe(false);
    expect(phoneRows.some((row) => row.group.id === first.id)).toBe(true);

    const audits = await app.inject({
      method: 'GET',
      url: '/api/gathering-admin/audits',
      headers: { cookie: localSession.cookie },
    });
    const actions = audits.json().items as Array<{ action: string; targetId: string | null }>;
    const approvals = actions.filter((item) => item.action === 'ADMIN_SUBSCRIPTION_APPROVE');
    expect(approvals.length).toBeGreaterThan(0);
    const secondSub = await prisma.gatheringSubscription.findFirstOrThrow({
      where: { groupId: second.id, source: 'PAID' },
    });
    expect(approvals.some((item) => item.targetId === secondSub.id)).toBe(false);
  });
});

async function send(session: { cookie: string; csrf: string }, method: 'POST', url: string, payload: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie: session.cookie, 'x-gathering-admin-csrf': session.csrf },
    payload: payload as object,
  });
}

async function enroll(loginId: string) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/login',
    payload: { loginId, password },
  });
  expect(login.statusCode).toBe(200);
  const started = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/totp/start',
    payload: { enrollmentToken: login.json().enrollmentToken },
  });
  const confirmed = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/totp/confirm',
    payload: { enrollmentToken: login.json().enrollmentToken, code: totpAt(started.json().secret as string, Date.now()) },
  });
  expect(confirmed.statusCode).toBe(200);
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
  return { token: res.json().tokens.accessToken as string, userId: res.json().user.id as string, phone };
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

function cookieOf(response: { headers: { 'set-cookie'?: string | string[] } }) {
  const raw = response.headers['set-cookie'];
  const line = Array.isArray(raw) ? raw[0] : raw;
  if (!line) throw new Error('세션 쿠키가 없습니다.');
  return line.split(';')[0] ?? '';
}

async function cleanup() {
  if (adminIds.length > 0) {
    await prisma.gatheringAdminAudit.deleteMany({ where: { OR: [{ actorAdminId: { in: adminIds } }, { targetId: { in: adminIds } }] } });
    await prisma.gatheringAdminOperation.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringDeposit.updateMany({ where: { confirmedByAdminId: { in: adminIds } }, data: { confirmedByAdminId: null } });
    await prisma.gatheringSubscription.updateMany({ where: { approvedByAdminId: { in: adminIds } }, data: { approvedByAdminId: null } });
    await prisma.gatheringAdminBankSetting.deleteMany({ where: { updatedByAdminId: { in: adminIds } } });
  }
  if (groupIds.length > 0) {
    await prisma.gatheringDepositLink.deleteMany({ where: { deposit: { groupId: { in: groupIds } } } });
    await prisma.gatheringDeposit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  }
  if (adminIds.length > 0) {
    await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminEnrollment.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  }
  if (userIds.length === 0) return;
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
