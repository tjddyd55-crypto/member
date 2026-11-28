import { randomInt, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { MembershipStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/auth-service.js';

const fixtureId = randomUUID();
const password = 'LocalFixturePassw0rd!';
const localIds: string[] = [];
const userIds: string[] = [];
const logs: string[] = [];

let app: FastifyInstance;
let districtId: string | undefined;
let localId: string;
let otherLocalId: string;
let member: Awaited<ReturnType<typeof loginFixture>>;
let gatheringOnly: Awaited<ReturnType<typeof loginFixture>>;
let membershipId: string;

async function loginFixture() {
  const phone = `010000${randomInt(10000, 100000)}`;
  const user = await prisma.user.create({
    data: {
      phone,
      passwordHash: await hashPassword(password),
      gatheringProfile: {
        create: { displayName: '가상 로컬 테스트 회원', directoryConsentAt: new Date() },
      },
    },
    select: { id: true },
  });
  userIds.push(user.id);
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/login',
    payload: { phone, password },
  });
  expect(response.statusCode).toBe(200);
  const { accessToken, refreshToken } = response.json<{
    tokens: { accessToken: string; refreshToken: string };
  }>().tokens;
  return { userId: user.id, phone, refreshToken, headers: { authorization: `Bearer ${accessToken}` } };
}

beforeAll(async () => {
  app = await buildApp({
    stream: new Writable({
      write(chunk, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    }),
  });

  const district = await prisma.district.create({ data: { code: fixtureId, name: '가상 테스트 지구' } });
  districtId = district.id;
  for (const suffix of ['a', 'b']) {
    const code = `${fixtureId}-${suffix}`;
    const local = await prisma.local.create({
      data: { districtId, name: `가상 테스트 로컬 ${suffix}`, code, slug: code, serviceEnabled: true },
    });
    localIds.push(local.id);
  }
  [localId, otherLocalId] = localIds;

  member = await loginFixture();
  gatheringOnly = await loginFixture();
  const membership = await prisma.localMembership.create({
    data: { userId: member.userId, localId, status: 'ACTIVE' },
  });
  membershipId = membership.id;
});

afterAll(async () => {
  try {
    await app?.close();
    await prisma.$transaction([
      prisma.localMembership.deleteMany({ where: { id: { in: membershipId ? [membershipId] : [] } } }),
      prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } }),
      prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      prisma.local.deleteMany({ where: { id: { in: localIds } } }),
      prisma.district.deleteMany({ where: { id: { in: districtId ? [districtId] : [] } } }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

function ping(target = localId, headers = member.headers) {
  return app.inject({ method: 'GET', url: `/api/local/${target}/ping`, headers });
}

function setMembershipStatus(status: MembershipStatus) {
  return prisma.localMembership.update({ where: { id: membershipId }, data: { status } });
}

function expectError(response: Awaited<ReturnType<typeof ping>>, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  expect(response.json().error.code).toBe(code);
}

describe('모임 로그인 기반 로컬 접근', () => {
  it('같은 로컬의 ACTIVE 회원을 허용한다', async () => {
    const response = await ping();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, localId, role: 'MEMBER' });
  });

  it('다른 로컬, 없는 로컬, 로컬 멤버십 없는 모임 계정을 같은 오류로 거부한다', async () => {
    const denied = await ping(otherLocalId);
    expectError(denied, 403, 'LOCAL_NOT_MEMBER');
    for (const response of [await ping(randomUUID()), await ping(localId, gatheringOnly.headers)]) {
      expect(response.statusCode).toBe(denied.statusCode);
      expect(response.json()).toEqual(denied.json());
    }
  });

  it.each([
    ['PENDING', 'LOCAL_PENDING'],
    ['REJECTED', 'LOCAL_REJECTED'],
    ['SUSPENDED', 'LOCAL_SUSPENDED'],
    ['WITHDRAWN', 'LOCAL_WITHDRAWN'],
  ] as const)('%s 멤버십을 다음 요청부터 거부한다', async (status, code) => {
    expect((await ping()).statusCode).toBe(200);
    await setMembershipStatus(status);
    try {
      expectError(await ping(), 403, code);
    } finally {
      await setMembershipStatus('ACTIVE');
    }
  });

  it('서비스를 끈 로컬의 ACTIVE 회원을 거부한다', async () => {
    await prisma.local.update({ where: { id: localId }, data: { serviceEnabled: false } });
    try {
      expectError(await ping(), 403, 'LOCAL_SERVICE_DISABLED');
    } finally {
      await prisma.local.update({ where: { id: localId }, data: { serviceEnabled: true } });
    }
  });

  it('비활성 로컬을 멤버십이 없는 경우와 동일하게 거부한다', async () => {
    await prisma.local.update({ where: { id: localId }, data: { isActive: false } });
    try {
      expect((await ping()).json()).toEqual((await ping(otherLocalId)).json());
      expectError(await ping(), 403, 'LOCAL_NOT_MEMBER');
    } finally {
      await prisma.local.update({ where: { id: localId }, data: { isActive: true } });
    }
  });

  it('인증 헤더가 없거나 토큰이 잘못되면 401을 반환한다', async () => {
    const url = `/api/local/${localId}/ping`;
    expectError(await app.inject({ method: 'GET', url }), 401, 'UNAUTHORIZED');
    expect((await ping(localId, { authorization: 'Bearer invalid-token' })).statusCode).toBe(401);
  });

  it('쿼리, 바디, 헤더의 localId를 무시하고 경로의 멤버십을 검사한다', async () => {
    for (const [target, supplied, status] of [[localId, otherLocalId, 200], [otherLocalId, localId, 403]] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/local/${target}/ping?localId=${supplied}`,
        payload: { localId: supplied },
        headers: { ...member.headers, 'x-local-id': supplied },
      });
      expect(response.statusCode).toBe(status);
      if (status === 200) {
        expect(response.json()).toEqual({ ok: true, localId, role: 'MEMBER' });
      } else {
        expectError(response, 403, 'LOCAL_NOT_MEMBER');
      }
    }
  });

  it('DB 역할에 따라 관리자 접근을 허용하거나 거부한다', async () => {
    const adminPing = () => app.inject({
      method: 'GET',
      url: `/api/local/${localId}/admin-ping?role=LOCAL_OWNER`,
      headers: member.headers,
    });
    expectError(await adminPing(), 403, 'LOCAL_FORBIDDEN');
    await prisma.localMembership.update({ where: { id: membershipId }, data: { role: 'LOCAL_ADMIN' } });
    try {
      const response = await adminPing();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, localId, role: 'LOCAL_ADMIN' });
    } finally {
      await prisma.localMembership.update({ where: { id: membershipId }, data: { role: 'MEMBER' } });
    }
  });

  it('로컬 성공·오류 본문과 요청 로그에 가상 개인정보를 남기지 않는다', async () => {
    const start = logs.length;
    for (const target of [localId, otherLocalId]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/local/${target}/ping?phone=${member.phone}`,
        payload: { phone: member.phone },
        headers: { ...member.headers, 'x-fixture-phone': member.phone },
      });
      expect(response.statusCode).toBe(target === localId ? 200 : 403);
      expect(response.body).not.toContain(member.phone);
      expect(response.body).not.toContain('가상 로컬 테스트 회원');
    }
    const requestLogs = logs.slice(start).map((line) => JSON.parse(line));
    expect(requestLogs.filter((entry) => entry.req?.method === 'GET')).toHaveLength(2);
    expect(requestLogs.filter((entry) => entry.res?.statusCode)).toHaveLength(2);
    expect(logs.slice(start).join('')).not.toContain(member.phone);
    expect(logs.slice(start).join('')).not.toContain(member.headers.authorization);
  });

  it('로그아웃은 refresh를 폐기하며 기존 access token은 DB 권한 변경 즉시 차단된다', async () => {
    const logout = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/logout',
      payload: { refreshToken: member.refreshToken },
    });
    expect(logout.statusCode).toBe(200);
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/refresh',
      payload: { refreshToken: member.refreshToken },
    });
    expectError(refresh, 401, 'INVALID_REFRESH');
    expect((await ping()).statusCode).toBe(200);
    await setMembershipStatus('SUSPENDED');
    expectError(await ping(), 403, 'LOCAL_SUSPENDED');
    await setMembershipStatus('ACTIVE');
    expect((await ping()).statusCode).toBe(200);

    try {
      await prisma.user.update({ where: { id: member.userId }, data: { status: 'SUSPENDED' } });
      expectError(await ping(), 403, 'LOCAL_FORBIDDEN');
      await prisma.user.update({ where: { id: member.userId }, data: { status: 'DELETED' } });
      expectError(await ping(), 401, 'UNAUTHORIZED');
    } finally {
      await prisma.user.update({ where: { id: member.userId }, data: { status: 'ACTIVE' } });
      await setMembershipStatus('ACTIVE');
    }

    await prisma.localMembership.delete({ where: { id: membershipId } });
    expectError(await ping(), 403, 'LOCAL_NOT_MEMBER');
  });
});
