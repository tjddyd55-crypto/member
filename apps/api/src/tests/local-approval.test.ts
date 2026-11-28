import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const fixture = randomUUID();
const localIds: string[] = [];
const userIds: string[] = [];
const profileIds: string[] = [];
const name = '가상 로컬 승인 회원';
let app: FastifyInstance;
let districtId: string | undefined;
let localId: string;
let otherLocalId: string;
let admin: Account;
let otherAdmin: Account;
let member: Account;
type Account = Awaited<ReturnType<typeof signup>>;

async function signup(target = localId) {
  const phone = `010001${randomInt(10000, 100000)}`;
  const response = await app.inject({
    method: 'POST', url: '/api/gathering/auth/register',
    payload: {
      phone, name, localId: target, password: 'LocalFixturePassw0rd!',
      directoryConsent: true, birthDate: '1960-01-15', sex: 'FEMALE',
    },
  });
  expect(response.statusCode).toBe(200);
  const { user, tokens } = response.json();
  const id = user.id as string;
  userIds.push(id);
  return { id, phone, headers: { authorization: `Bearer ${tokens.accessToken}` } };
}

beforeAll(async () => {
  app = await buildApp();
  districtId = (await prisma.district.create({ data: { code: fixture, name: '가상 로컬 승인 지구' } })).id;
  for (const suffix of ['a', 'b']) {
    const code = `${fixture}-${suffix}`;
    const local = await prisma.local.create({
      data: { districtId, code, slug: code, name: `가상 로컬 승인 ${suffix}`, verificationState: 'CONFIRMED', serviceEnabled: true },
    });
    localIds.push(local.id);
  }
  [localId, otherLocalId] = localIds;
  admin = await signup();
  otherAdmin = await signup(otherLocalId);
  member = await signup();
  await prisma.localMembership.createMany({ data: [
    { userId: admin.id, localId, role: 'LOCAL_ADMIN', status: 'ACTIVE' },
    { userId: otherAdmin.id, localId: otherLocalId, role: 'LOCAL_ADMIN', status: 'ACTIVE' },
    { userId: member.id, localId, status: 'ACTIVE' },
  ] });
});

afterAll(async () => {
  try {
    await app?.close();
    const userId = { in: userIds };
    const localId = { in: localIds };
    const memberProfileId = { in: profileIds };
    await prisma.$transaction([
      prisma.localMemberClassChange.deleteMany({ where: { changedByUserId: userId, localId } }),
      prisma.auditLog.deleteMany({ where: { actorUserId: userId, localId } }),
      prisma.localMembership.deleteMany({ where: { userId, localId } }),
      prisma.memberPositionHistory.deleteMany({ where: { memberProfileId, localId } }),
      prisma.memberProfile.deleteMany({ where: { id: memberProfileId, localId } }),
      prisma.gatheringSession.deleteMany({ where: { userId } }),
      prisma.gatheringRecoveryCode.deleteMany({ where: { userId } }),
      prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: userId } }),
      prisma.gatheringLocalAffiliation.deleteMany({ where: { userId } }),
      prisma.gatheringProfile.deleteMany({ where: { userId } }),
      prisma.user.deleteMany({ where: { id: userId } }),
      prisma.local.deleteMany({ where: { id: localId } }),
      prisma.district.deleteMany({ where: { id: { in: districtId ? [districtId] : [] } } }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

async function apply(target = localId) {
  const account = await signup(target);
  const response = await app.inject({
    method: 'POST', url: `/api/local/${target}/join-request`, headers: account.headers,
  });
  expect(response.statusCode).toBe(201);
  const membership = await prisma.localMembership.findUniqueOrThrow({
    where: { userId_localId: { userId: account.id, localId: target } },
  });
  return { account, membership };
}

function call(method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, actor: Account | null = admin, target = localId) {
  return app.inject({ method, url: `/api/local/${target}/admin/${path}`, payload, headers: actor?.headers });
}

function me(account: Account) {
  return app.inject({ url: '/api/local/me', headers: account.headers });
}

function ping(account: Account) {
  return app.inject({ url: `/api/local/${localId}/ping`, headers: account.headers });
}

function expectError(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  expect(response.json().error.code).toBe(code);
}

describe('로컬 가입 승인과 기본 분류', () => {
  it('대기 목록의 로컬과 상태를 제한하고 전화번호 끝 네 자리만 표시한다', async () => {
    const { account, membership } = await apply();
    const foreign = await apply(otherLocalId);
    const list = await call('GET', 'join-requests');
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual([{
      membershipId: membership.id, requestedAt: membership.updatedAt.toISOString(),
      displayName: name, phoneMasked: `****${account.phone.slice(-4)}`,
      affiliationName: (await me(account)).json().affiliation.localJcName,
    }]);
    expect(list.body).not.toContain(account.phone);
    expect(list.body).not.toContain(foreign.membership.id);
    expectError(await call('GET', 'join-requests', undefined, member), 403, 'LOCAL_FORBIDDEN');
  });

  it('DB의 관리자 권한과 대상 로컬을 검사하고 본인 요청과 비로그인 접근을 거절한다', async () => {
    const { membership } = await apply();
    const foreign = await apply(otherLocalId);
    const path = `join-requests/${membership.id}/approve`;
    const payload = { memberClass: 'YB' };
    expectError(await call('POST', path, payload, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('POST', path, payload, otherAdmin), 403, 'LOCAL_NOT_MEMBER');
    expectError(await call('POST', path, payload, otherAdmin, otherLocalId), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', `join-requests/${foreign.membership.id}/approve`, payload), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', path, payload, null), 401, 'UNAUTHORIZED');
    const self = await prisma.localMembership.findUniqueOrThrow({ where: { userId_localId: { userId: admin.id, localId } } });
    await prisma.localMembership.update({ where: { id: self.id }, data: { status: 'PENDING' } });
    try {
      expectError(await call('POST', `join-requests/${self.id}/approve`, payload), 403, 'LOCAL_PENDING');
    } finally {
      await prisma.localMembership.update({ where: { id: self.id }, data: { status: 'ACTIVE' } });
    }
    expectError(await call('POST', `join-requests/${self.id}/approve`, payload), 403, 'LOCAL_SELF_REQUEST');
  });

  it('동시 승인 한 건만 반영하고 만 45세 이상 회원도 지정된 YB를 유지한다', async () => {
    const { account, membership } = await apply();
    const existingProfile = await prisma.memberProfile.create({
      data: { localId, phone: account.phone, name, birthDate: new Date('1960-01-15') },
    });
    profileIds.push(existingProfile.id);
    const path = `join-requests/${membership.id}/approve`;
    const payload = { memberClass: 'YB', note: '가상 가입 확인' };
    const responses = await Promise.all([call('POST', path, payload), call('POST', path, payload)]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expectError(responses.find(({ statusCode }) => statusCode === 409)!, 409, 'LOCAL_REQUEST_NOT_PENDING');
    expectError(await call('POST', path, payload), 409, 'LOCAL_REQUEST_NOT_PENDING');

    const saved = await prisma.localMembership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(saved).toMatchObject({
      status: 'ACTIVE', role: 'MEMBER', memberClass: 'YB', approvedByUserId: admin.id, memberProfileId: null,
      approvedAt: expect.any(Date), joinedAt: expect.any(Date),
    });
    expect(saved.approvedAt).toEqual(saved.joinedAt);
    expect(await prisma.memberProfile.findUnique({ where: { id: existingProfile.id } })).toEqual(existingProfile);
    expect(await prisma.memberProfile.count({ where: { localId, userId: account.id } })).toBe(0);
    expect((await me(account)).json()).toMatchObject({ state: 'ACTIVE', membership: { status: 'ACTIVE', role: 'MEMBER' } });
    expect((await ping(account)).statusCode).toBe(200);
    expect((await call('GET', 'join-requests')).json().items.map(({ membershipId }: { membershipId: string }) => membershipId))
      .not.toContain(membership.id);
    expect(await prisma.localMemberClassChange.findMany({ where: { membershipId: membership.id } })).toEqual([
      expect.objectContaining({ fromClass: null, toClass: 'YB', changedByUserId: admin.id, reason: payload.note }),
    ]);
    const audits = await prisma.auditLog.findMany({ where: { localId, targetId: membership.id, action: 'LOCAL_JOIN_APPROVED' } });
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].metaJson!)).toEqual({ membershipId: membership.id, memberClass: 'YB' });
    expect(await prisma.localMembership.findUnique({ where: { id: membership.id }, select: { memberClass: true } }))
      .toEqual({ memberClass: 'YB' });
  });

  it('거절 사유를 기록하고 이후 승인 및 로컬 접근을 차단한다', async () => {
    const { account, membership } = await apply();
    const path = `join-requests/${membership.id}`;
    const reason = '가상 거절 사유';
    expect((await call('POST', `${path}/reject`, { reason: ' ' })).statusCode).toBe(400);
    expect((await call('POST', `${path}/reject`, { reason })).statusCode).toBe(200);
    expectError(await call('POST', `${path}/reject`, { reason }), 409, 'LOCAL_REQUEST_NOT_PENDING');
    expectError(await call('POST', `${path}/approve`, { memberClass: 'OB' }), 409, 'LOCAL_REQUEST_NOT_PENDING');
    expect((await me(account)).json()).toMatchObject({ state: 'REJECTED', membership: { status: 'REJECTED' } });
    expectError(await ping(account), 403, 'LOCAL_REJECTED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { localId, targetId: membership.id, action: 'LOCAL_JOIN_REJECTED' } });
    expect(audit.actorUserId).toBe(admin.id);
    expect(JSON.parse(audit.metaJson!)).toEqual({ membershipId: membership.id, reason });
    expect(await prisma.localMemberClassChange.count({ where: { membershipId: membership.id } })).toBe(0);
  });

  it('수동 전환과 동시 되돌리기에서 멤버십과 연결 이력을 보존한다', async () => {
    const { account, membership } = await apply();
    const path = `members/${membership.id}/class`;
    const payload = { memberClass: 'OB', reason: '가상 특우 전환' };
    expectError(await call('PATCH', path, payload), 409, 'LOCAL_MEMBER_NOT_ACTIVE');
    const foreign = await apply(otherLocalId);
    const foreignPath = `members/${foreign.membership.id}/class`;
    expectError(await call('PATCH', foreignPath, payload), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('GET', `${foreignPath}-history`), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', `${foreignPath}/revert`, { reason: '가상 되돌리기' }), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expect((await call('POST', `join-requests/${membership.id}/approve`, { memberClass: 'YB' })).statusCode).toBe(200);
    expectError(await call('POST', `${path}/revert`, { reason: '가상 되돌리기' }), 409, 'LOCAL_CLASS_NOT_REVERTIBLE');

    const profile = await prisma.memberProfile.create({ data: { localId, userId: account.id, name } });
    profileIds.push(profile.id);
    const position = await prisma.memberPositionHistory.create({
      data: { memberProfileId: profile.id, localId, note: '가상 직책 이력' },
    });
    const original = await prisma.localMembership.update({
      where: { id: membership.id }, data: { memberProfileId: profile.id },
    });

    expect((await call('PATCH', path, { memberClass: 'OB' })).statusCode).toBe(400);
    expectError(await call('PATCH', path, payload, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('GET', `${path}-history`, undefined, member), 403, 'LOCAL_FORBIDDEN');
    expect((await call('PATCH', path, payload)).json()).toEqual({ membership: { id: membership.id, memberClass: 'OB' } });
    expectError(await call('PATCH', path, payload), 409, 'LOCAL_CLASS_UNCHANGED');
    const history = (await call('GET', `${path}-history`)).json().items;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      changedByDisplayName: name, createdAt: expect.any(String), fromClass: 'YB', toClass: 'OB', reason: payload.reason,
    });
    const revert = () => call('POST', `${path}/revert`, { reason: '가상 전환 취소' });
    const responses = await Promise.all([revert(), revert()]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expectError(await revert(), 409, 'LOCAL_CLASS_NOT_REVERTIBLE');
    const reverted = (await call('GET', `${path}-history`)).json().items;
    expect(reverted).toEqual([
      expect.objectContaining({ revertsChangeId: history[0].id, fromClass: 'OB', toClass: 'YB', reason: '가상 전환 취소' }),
      ...history,
    ]);

    expect(await prisma.localMembership.findUnique({ where: { id: membership.id } }))
      .toEqual({ ...original, updatedAt: expect.any(Date) });
    expect(await prisma.memberProfile.findMany({ where: { localId, userId: account.id } })).toEqual([profile]);
    expect(await prisma.memberPositionHistory.findMany({ where: { memberProfileId: profile.id } })).toEqual([position]);
    expect(await prisma.auditLog.count({ where: { localId, targetId: membership.id, action: 'LOCAL_MEMBER_CLASS_CHANGED' } })).toBe(2);
  });
});
