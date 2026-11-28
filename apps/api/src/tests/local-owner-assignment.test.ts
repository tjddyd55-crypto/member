import { randomInt, randomUUID } from 'node:crypto';
import type { GatheringAdminRole, MembershipStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/auth-service.js';

const fixture = randomUUID();
const password = 'LocalOwnerFixturePassw0rd!';
const displayName = '가상 로컬 가입 신청자';
const note = '가입 신청자 본인 확인 완료';
const userIds: string[] = [];
const adminIds: string[] = [];
const localIds: string[] = [];
let app: FastifyInstance;
let districtId: string | undefined;
let local: string;
let otherLocal: string;
let raceLocal: string;
let root: Awaited<ReturnType<typeof admin>>;
let ordinary: Awaited<ReturnType<typeof admin>>;

async function admin(role: GatheringAdminRole) {
  const loginId = `owner.${role.toLowerCase()}.${fixture.slice(0, 8)}`;
  const { id } = await prisma.gatheringAdminAccount.create({
    data: { loginId, role, passwordHash: await hashPassword(password) },
  });
  adminIds.push(id);
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/login',
    payload: { loginId, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = response.cookies.find((item) => item.name === 'gathering_admin_session');
  return {
    id,
    loginId,
    headers: {
      cookie: `gathering_admin_session=${cookie!.value}`,
      'x-gathering-admin-csrf': response.json().csrfToken as string,
    },
  };
}

async function signup(target: string) {
  const phone = `010008${randomInt(10000, 100000)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: {
      phone,
      name: displayName,
      localId: target,
      password,
      directoryConsent: true,
      birthDate: '1960-01-15',
      sex: 'FEMALE',
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const { user, tokens } = response.json();
  const id = user.id as string;
  userIds.push(id);
  const email = `${id}@example.invalid`;
  await prisma.user.update({ where: { id }, data: { email } });
  return { id, phone, email, headers: { authorization: `Bearer ${tokens.accessToken}` } };
}

async function apply(target = local) {
  const account = await signup(target);
  const response = await app.inject({
    method: 'POST',
    url: `/api/local/${target}/join-request`,
    headers: account.headers,
  });
  expect(response.statusCode, response.body).toBe(201);
  const membership = await prisma.localMembership.findUniqueOrThrow({
    where: { userId_localId: { userId: account.id, localId: target } },
  });
  return { account, membershipId: membership.id };
}

function call(
  path: string,
  payload?: object,
  target = local,
  headers = root.headers as Record<string, string>,
) {
  return app.inject({
    method: payload ? 'POST' : 'GET',
    url: `/api/gathering-admin/jc-orgs/locals/${target}/${path}`,
    payload,
    headers,
  });
}

function appointment(membershipId: string) {
  return { membershipId, identityVerified: true, note, memberClass: 'YB' };
}

function expectError(response: Awaited<ReturnType<typeof call>>, status: number, code?: string) {
  expect(response.statusCode, response.body).toBe(status);
  if (code) expect(response.json().error.code).toBe(code);
}

function readMembership(id: string) {
  return prisma.localMembership.findUniqueOrThrow({ where: { id } });
}

function localAdmin(account: Awaited<ReturnType<typeof signup>>, target = local) {
  return app.inject({ url: `/api/local/${target}/admin/join-requests`, headers: account.headers });
}

beforeAll(async () => {
  app = await buildApp();
  root = await admin('SUPER_ADMIN');
  ordinary = await admin('ADMIN');
  districtId = (
    await prisma.district.create({ data: { code: fixture, name: '가상 관리자 지정 지구' } })
  ).id;
  for (const suffix of ['primary', 'other', 'race']) {
    const code = `${fixture}-${suffix}`;
    const row = await prisma.local.create({
      data: {
        districtId,
        code,
        slug: code,
        name: `가상 관리자 지정 ${suffix}`,
        serviceEnabled: true,
        verificationState: 'CONFIRMED',
      },
    });
    localIds.push(row.id);
  }
  [local, otherLocal, raceLocal] = localIds;
});

afterAll(async () => {
  try {
    await app?.close();
    const localId = { in: localIds };
    const userId = { in: userIds };
    const adminId = { in: adminIds };
    await prisma.$transaction([
      prisma.localOwnerAssignment.deleteMany({ where: { localId } }),
      prisma.localMemberClassChange.deleteMany({ where: { localId } }),
      prisma.auditLog.deleteMany({ where: { localId } }),
      prisma.localMembership.deleteMany({ where: { localId, userId } }),
      prisma.memberProfile.deleteMany({ where: { localId, userId } }),
      prisma.gatheringSession.deleteMany({ where: { userId } }),
      prisma.gatheringRecoveryCode.deleteMany({ where: { userId } }),
      prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: userId } }),
      prisma.gatheringLocalAffiliation.deleteMany({ where: { userId } }),
      prisma.gatheringProfile.deleteMany({ where: { userId } }),
      prisma.user.deleteMany({ where: { id: userId } }),
      prisma.local.deleteMany({ where: { id: localId } }),
      prisma.district.deleteMany({ where: { id: { in: districtId ? [districtId] : [] } } }),
      prisma.gatheringAdminSession.deleteMany({ where: { adminId } }),
      prisma.gatheringAdminAudit.deleteMany({ where: { actorAdminId: adminId } }),
      prisma.gatheringAdminAccount.deleteMany({ where: { id: adminId } }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

describe('최초 로컬 관리자 지정', () => {
  it('모든 경로에서 최고관리자 세션을 요구하고 변경에는 CSRF도 요구한다', async () => {
    const { membershipId } = await apply();
    const changes = [
      ['owner', appointment(membershipId)],
      ['owner/revoke', { membershipId, reason: '지정 정정' }],
    ] as const;
    for (const [path, payload] of [
      ...changes,
      ['owner', undefined],
      ['owner-candidates', undefined],
    ] as const) {
      expectError(await call(path, payload, local, {}), 401);
      expectError(await call(path, payload, local, ordinary.headers), 403, 'FORBIDDEN');
    }
    for (const [path, payload] of changes) {
      expectError(await call(path, payload, local, { cookie: root.headers.cookie }), 403, 'CSRF');
    }
  });

  it('명시적 본인 확인, 메모, 대기 회원 분류 및 엄격한 요청 형식을 검증한다', async () => {
    const { membershipId } = await apply();
    const body = appointment(membershipId);
    for (const invalid of [
      { identityVerified: undefined },
      { identityVerified: false },
      { note: undefined },
      { note: ' ' },
      { note: '가'.repeat(301) },
      { phone: 'fixture' },
      { memberClass: 'OTHER' },
    ]) {
      expectError(await call('owner', { ...body, ...invalid }), 400, 'VALIDATION_ERROR');
    }
    expectError(
      await call('owner', { ...body, memberClass: undefined }),
      400,
      'LOCAL_MEMBER_CLASS_REQUIRED',
    );
    expectError(await call('owner/revoke', { membershipId, reason: ' ' }), 400, 'VALIDATION_ERROR');
    expectError(
      await call('owner/revoke', { membershipId, reason: '정정' }),
      409,
      'LOCAL_NOT_OWNER',
    );
  });

  it('가입 요청 출처, 상태, 로컬 범위와 서비스 상태를 검사한다', async () => {
    const other = await apply(otherLocal);
    const neverApplied = await signup(local);
    const manual = await prisma.localMembership.create({
      data: { localId: local, userId: neverApplied.id, status: 'ACTIVE', memberClass: 'OB' },
    });
    await prisma.memberProfile.create({
      data: {
        localId: local,
        userId: neverApplied.id,
        name: displayName,
        phone: neverApplied.phone,
      },
    });
    for (const id of [other.membershipId, neverApplied.id, manual.id]) {
      expectError(await call('owner', appointment(id)), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    }
    expectError(
      await call('owner/revoke', { membershipId: other.membershipId, reason: '정정' }),
      404,
    );

    const excluded = [other.membershipId, manual.id];
    for (const status of ['WITHDRAWN', 'REJECTED', 'SUSPENDED'] satisfies MembershipStatus[]) {
      const { membershipId } = await apply();
      await prisma.localMembership.update({ where: { id: membershipId }, data: { status } });
      excluded.push(membershipId);
      expectError(
        await call('owner', appointment(membershipId)),
        409,
        'LOCAL_OWNER_CANDIDATE_INELIGIBLE',
      );
    }
    const valid = await apply();
    const candidates = await call('owner-candidates');
    expect(candidates.statusCode, candidates.body).toBe(200);
    const list = candidates.json().items;
    expect(list.map((item: { membershipId: string }) => item.membershipId)).toContain(
      valid.membershipId,
    );
    for (const id of excluded) expect(candidates.body).not.toContain(id);
    expect(await readMembership(manual.id)).toMatchObject({ role: 'MEMBER' });

    try {
      await prisma.local.update({ where: { id: local }, data: { serviceEnabled: false } });
      expectError(
        await call('owner', appointment(valid.membershipId)),
        409,
        'LOCAL_SERVICE_DISABLED',
      );
      await prisma.local.update({
        where: { id: local },
        data: { isActive: false, serviceEnabled: true },
      });
      expectError(await call('owner', appointment(valid.membershipId)), 409, 'JC_ORG_INACTIVE');
    } finally {
      await prisma.local.update({
        where: { id: local },
        data: { isActive: true, serviceEnabled: true },
      });
    }
  });

  it('동시 지정 요청 중 한 건만 승인한다', async () => {
    const first = await apply(raceLocal);
    const second = await apply(raceLocal);
    const responses = await Promise.all(
      [first, second].map(({ membershipId }) =>
        call('owner', appointment(membershipId), raceLocal),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expectError(
      responses.find((response) => response.statusCode === 409)!,
      409,
      'LOCAL_OWNER_EXISTS',
    );
    expect(
      await prisma.localMembership.count({
        where: { localId: raceLocal, role: 'LOCAL_OWNER', status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.localOwnerAssignment.count({
        where: { localId: raceLocal, action: 'APPOINTED' },
      }),
    ).toBe(1);
  });

  it('대기 승인과 지정, 권한 검사, 해임과 재지정까지 기록한다', async () => {
    const { account, membershipId } = await apply();
    const alternative = await apply();
    const candidates = await call('owner-candidates');
    const request = await prisma.auditLog.findFirstOrThrow({
      where: { localId: local, targetId: membershipId, action: 'LOCAL_JOIN_REQUESTED' },
    });
    expect(candidates.json().items).toContainEqual({
      membershipId,
      status: 'PENDING',
      role: 'MEMBER',
      memberClass: null,
      displayName,
      phoneMasked: `****${account.phone.slice(-4)}`,
      requestedAt: request.createdAt.toISOString(),
    });
    const orderedDates = candidates
      .json()
      .items.map((item: { requestedAt: string }) => item.requestedAt);
    expect(orderedDates).toEqual([...orderedDates].sort());
    for (const privateValue of [account.phone, account.email, '1960-01-15']) {
      expect(candidates.body).not.toContain(privateValue);
    }

    const profile = await prisma.memberProfile.create({
      data: { localId: local, userId: account.id, name: displayName },
    });
    await prisma.localMembership.update({
      where: { id: membershipId },
      data: { memberProfileId: profile.id },
    });
    const assigned = await call('owner', appointment(membershipId));
    expect(assigned.statusCode, assigned.body).toBe(200);
    const approved = await readMembership(membershipId);
    expect(approved).toMatchObject({
      status: 'ACTIVE',
      role: 'LOCAL_OWNER',
      memberClass: 'YB',
      approvedAt: expect.any(Date),
      joinedAt: expect.any(Date),
      memberProfileId: profile.id,
    });
    expect(approved.joinedAt).toEqual(approved.approvedAt);
    expect(await prisma.localMemberClassChange.findMany({ where: { membershipId } })).toMatchObject(
      [
        {
          fromClass: null,
          toClass: 'YB',
          reason: '최초 관리자 지정',
          changedByAdminId: root.id,
          changedByUserId: null,
        },
      ],
    );
    expect((await localAdmin(account)).statusCode).toBe(200);
    expectError(await localAdmin(account, otherLocal), 403, 'LOCAL_NOT_MEMBER');
    expectError(
      await call('owner', appointment(alternative.membershipId)),
      409,
      'LOCAL_OWNER_EXISTS',
    );

    const current = await call('owner');
    expect(current.json().owner).toEqual({
      membershipId,
      displayName,
      phoneMasked: `****${account.phone.slice(-4)}`,
      appointedAt: expect.any(String),
    });
    expect(current.json().history).toMatchObject([
      { membershipId, action: 'APPOINTED', note, actorLabel: root.loginId },
    ]);
    const reason = '가상 지정 정정';
    expect((await call('owner/revoke', { membershipId, reason })).statusCode).toBe(200);
    expect(await readMembership(membershipId)).toEqual({
      ...approved,
      role: 'MEMBER',
      updatedAt: expect.any(Date),
    });
    expect(await prisma.memberProfile.findUnique({ where: { id: profile.id } })).toEqual(profile);
    expectError(await localAdmin(account), 403, 'LOCAL_FORBIDDEN');

    const revoked = await call('owner');
    expect(revoked.json()).toMatchObject({
      owner: null,
      history: [
        { membershipId, action: 'REVOKED', note: reason, actorLabel: root.loginId },
        { action: 'APPOINTED' },
      ],
    });
    for (const privateValue of [account.phone, account.email, '1960-01-15']) {
      expect(current.body).not.toContain(privateValue);
      expect(revoked.body).not.toContain(privateValue);
    }
    const audits = await prisma.auditLog.findMany({
      where: { localId: local, targetId: membershipId, action: { startsWith: 'LOCAL_OWNER_' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(({ action }) => action)).toEqual([
      'LOCAL_OWNER_APPOINTED',
      'LOCAL_OWNER_REVOKED',
    ]);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        actorUserId: null,
        targetType: 'LocalMembership',
        targetId: membershipId,
        localId: local,
      });
      expect(JSON.parse(audit.metaJson!)).toEqual({
        actorAdminId: root.id,
        actorLabel: root.loginId,
      });
    }

    const promoted = await call('owner', { ...appointment(membershipId), memberClass: 'OB' });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(await readMembership(membershipId)).toEqual({
      ...approved,
      updatedAt: expect.any(Date),
    });
    expect(await prisma.localMemberClassChange.count({ where: { membershipId } })).toBe(1);
  });

  it('분류가 없는 승인 회원은 지정 시 분류를 받아야 한다', async () => {
    const { membershipId } = await apply(otherLocal);
    const at = new Date('2026-01-01T00:00:00Z');
    const before = await prisma.localMembership.update({
      where: { id: membershipId },
      data: { status: 'ACTIVE', joinedAt: at, approvedAt: at },
    });
    expectError(
      await call('owner', { ...appointment(membershipId), memberClass: undefined }, otherLocal),
      400,
      'LOCAL_MEMBER_CLASS_REQUIRED',
    );
    const response = await call(
      'owner',
      { ...appointment(membershipId), memberClass: 'OB' },
      otherLocal,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(await readMembership(membershipId)).toEqual({
      ...before,
      role: 'LOCAL_OWNER',
      memberClass: 'OB',
      updatedAt: expect.any(Date),
    });
  });
});
