import { randomInt, randomUUID } from 'node:crypto';
import type { MembershipStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const fixture = randomUUID();
const userIds: string[] = [];
const localIds: string[] = [];
const profileIds: string[] = [];
let app: FastifyInstance;
let districtId: string | undefined;
let localId: string;
let otherLocalId: string;
let user: Awaited<ReturnType<typeof signup>>;
let other: Awaited<ReturnType<typeof signup>>;
const name = '가상 가입 요청 회원';
const pending = { status: 'PENDING', role: 'MEMBER' };
const districtName = '가상 가입 요청 지구';
const localName = '가상 가입 요청 로컬 a';

async function signup() {
  const phone = `010000${randomInt(10000, 100000)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: {
      phone, name, localId, password: 'LocalFixturePassw0rd!',
      directoryConsent: true, birthDate: '1990-01-15', sex: 'FEMALE',
    },
  });
  expect(response.statusCode).toBe(200);
  const { user, tokens } = response.json();
  userIds.push(user.id);
  return { id: user.id as string, phone, headers: { authorization: `Bearer ${tokens.accessToken}` } };
}

beforeAll(async () => {
  app = await buildApp();
  const district = await prisma.district.create({ data: { code: fixture, name: districtName } });
  districtId = district.id;
  for (const suffix of ['a', 'b', 'disabled', 'inactive']) {
    const code = `${fixture}-${suffix}`;
    const local = await prisma.local.create({
      data: {
        districtId, code, slug: code, name: `가상 가입 요청 로컬 ${suffix}`,
        verificationState: 'CONFIRMED', serviceEnabled: suffix !== 'disabled', isActive: suffix !== 'inactive',
      },
    });
    localIds.push(local.id);
  }
  [localId, otherLocalId] = localIds;
  user = await signup();
  other = await signup();
  const profile = await prisma.memberProfile.create({ data: { localId, name, phone: user.phone } });
  profileIds.push(profile.id);
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds }, localId: { in: localIds } } });
  await prisma.localMembership.deleteMany({ where: { userId: { in: userIds }, localId: { in: localIds } } });
});

afterAll(async () => {
  try {
    await app?.close();
    const userId = { in: userIds };
    const localId = { in: localIds };
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { actorUserId: userId, localId } }),
      prisma.localMembership.deleteMany({ where: { userId, localId } }),
      prisma.memberProfile.deleteMany({ where: { id: { in: profileIds } } }),
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

function me() {
  return app.inject({ method: 'GET', url: '/api/local/me', headers: user.headers });
}

function join(method: 'POST' | 'DELETE' = 'POST', target = localId, headers = user.headers) {
  return app.inject({ method, url: `/api/local/${target}/join-request`, headers });
}

async function expectState(state: string, membership: unknown = null) {
  const response = await me();
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    affiliation: { localJcName: localName, local: { id: localId, name: localName, districtName } },
    state, membership,
  });
  expect(response.body).not.toContain(user.phone);
  expect(response.body).not.toContain(name);
}

function expectError(response: Awaited<ReturnType<typeof join>>, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  expect(response.json().error.code).toBe(code);
}

function createMembership(status: MembershipStatus, target = localId, userId = user.id) {
  return prisma.localMembership.create({ data: { userId, localId: target, status } });
}

function ownMemberships() {
  return prisma.localMembership.findMany({ where: { userId: user.id } });
}

describe('내 로컬 및 수동 가입 요청', () => {
  it('가입 시 로컬 선택만으로 멤버십을 만들지 않는다', async () => {
    expect(await ownMemberships()).toEqual([]);
    await expectState('NOT_REQUESTED');
    await createMembership('ACTIVE', otherLocalId);
    await expectState('NOT_REQUESTED');
  });

  it('현재 소속이 없거나 이름만 있는 경우를 구분하고 최신 현재 소속을 사용한다', async () => {
    const current = await prisma.gatheringLocalAffiliation.findFirstOrThrow({ where: { userId: user.id, isCurrent: true } });
    const unmatched = await prisma.gatheringLocalAffiliation.create({
      data: { userId: user.id, localJcName: '가상 미연결 로컬', createdAt: new Date(current.createdAt.getTime() + 1) },
    });
    try {
      expect((await me()).json()).toEqual({
        affiliation: { localJcName: unmatched.localJcName, local: null }, state: 'LOCAL_NOT_LINKED', membership: null,
      });
      expectError(await join(), 403, 'LOCAL_AFFILIATION_MISMATCH');
      await prisma.gatheringLocalAffiliation.updateMany({ where: { id: { in: [current.id, unmatched.id] } }, data: { isCurrent: false } });
      expect((await me()).json()).toEqual({ affiliation: null, state: 'NO_AFFILIATION', membership: null });
    } finally {
      await prisma.gatheringLocalAffiliation.delete({ where: { id: unmatched.id } });
      await prisma.gatheringLocalAffiliation.update({ where: { id: current.id }, data: { isCurrent: true } });
    }
  });

  it.each(['isActive', 'serviceEnabled'] as const)('%s가 꺼진 경우 멤버십 상태보다 서비스 상태를 우선한다', async (field) => {
    await createMembership('ACTIVE');
    await prisma.local.update({ where: { id: localId }, data: { [field]: false } });
    try {
      await expectState('SERVICE_NOT_ENABLED', { status: 'ACTIVE', role: 'MEMBER' });
    } finally {
      await prisma.local.update({ where: { id: localId }, data: { [field]: true } });
    }
  });

  it.each([
    ['ACTIVE', 409, 'LOCAL_ALREADY_MEMBER'],
    ['REJECTED', 409, 'LOCAL_REQUEST_REJECTED'],
    ['SUSPENDED', 403, 'LOCAL_SUSPENDED'],
  ] as const)('%s 상태를 표시하고 가입 요청을 거부한다', async (status, httpStatus, code) => {
    await createMembership(status);
    await expectState(status, { status, role: 'MEMBER' });
    expectError(await join(), httpStatus, code);
    expectError(await join('DELETE'), 409, 'LOCAL_REQUEST_NOT_PENDING');
  });

  it('동시 요청은 한 행과 감사로그 한 건을 만들고 PENDING 접근을 차단한다', async () => {
    const responses = await Promise.all([join(), join()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    for (const response of responses) expect(response.json()).toEqual({ membership: pending });
    const [membership] = await ownMemberships();
    expect(await ownMemberships()).toHaveLength(1);
    expect(membership).toMatchObject({ localId, memberProfileId: null, ...pending });
    await expectState('PENDING', pending);
    expectError(await app.inject({ url: `/api/local/${localId}/ping`, headers: user.headers }), 403, 'LOCAL_PENDING');
    const repeated = await app.inject({
      method: 'POST', url: `/api/local/${localId}/join-request`, headers: user.headers, payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect(await prisma.auditLog.findMany({ where: { actorUserId: user.id, localId } })).toEqual([
      expect.objectContaining({
        action: 'LOCAL_JOIN_REQUESTED', actorUserId: user.id, localId,
        targetType: 'LocalMembership', targetId: membership.id, metaJson: null,
      }),
    ]);
  });

  it('타인의 요청을 건드리지 않고 본인 요청을 취소한 후 같은 행으로 재요청한다', async () => {
    const membership = await createMembership('PENDING');
    expectError(await join('DELETE', localId, other.headers), 404, 'LOCAL_REQUEST_NOT_FOUND');
    await expectState('PENDING', pending);

    const canceled = await join('DELETE');
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toEqual({ membership: { status: 'WITHDRAWN', role: 'MEMBER' } });
    await expectState('WITHDRAWN', { status: 'WITHDRAWN', role: 'MEMBER' });
    expectError(await join('DELETE'), 409, 'LOCAL_REQUEST_NOT_PENDING');

    const reopened = await join();
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ membership: pending });
    await expectState('PENDING', pending);
    expect(await ownMemberships()).toEqual([expect.objectContaining({ id: membership.id, ...pending })]);
    const audits = await prisma.auditLog.findMany({ where: { localId, actorUserId: { in: userIds } } });
    expect(audits).toHaveLength(2);
    expect(audits.map(({ action }) => action).sort()).toEqual(['LOCAL_JOIN_CANCELED', 'LOCAL_JOIN_REQUESTED']);
    for (const audit of audits) {
      expect(audit).toMatchObject({ actorUserId: user.id, localId, targetId: membership.id, targetType: 'LocalMembership', metaJson: null });
    }
  });

  it('비로그인·서비스 미활성·현재 소속 불일치·잘못된 본문을 거부한다', async () => {
    expectError(await app.inject({ url: '/api/local/me' }), 401, 'UNAUTHORIZED');
    expectError(await join('POST', localId, {}), 401, 'UNAUTHORIZED');
    expectError(await join('DELETE', localId, {}), 401, 'UNAUTHORIZED');
    const missing = await join('POST', randomUUID());
    expectError(missing, 403, 'LOCAL_SERVICE_NOT_ENABLED');
    for (const target of localIds.slice(2)) {
      const response = await join('POST', target);
      expect(response.statusCode).toBe(missing.statusCode);
      expect(response.json()).toEqual(missing.json());
    }
    expectError(await join('POST', otherLocalId), 403, 'LOCAL_AFFILIATION_MISMATCH');
    const invalid = await app.inject({
      method: 'POST', url: `/api/local/${localId}/join-request`, headers: user.headers, payload: { role: 'LOCAL_OWNER' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(await ownMemberships()).toEqual([]);
  });
});
