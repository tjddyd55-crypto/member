import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const fixture = randomUUID();
const localIds: string[] = [];
const userIds: string[] = [];
const profileIds: string[] = [];
const name = '가상 프로필 연결 회원';
let app: FastifyInstance;
let districtId: string | undefined;
let localId: string;
let otherLocalId: string;
let admin: Account;
let otherAdmin: Account;
let member: Account;
type Account = Awaited<ReturnType<typeof signup>>;

const password = 'LocalFixturePassw0rd!';
const fixturePhone = () => `010002${randomInt(10000, 100000)}`;

async function signup(target = localId, phone = fixturePhone()) {
  const response = await app.inject({
    method: 'POST', url: '/api/gathering/auth/register',
    payload: {
      phone, name, localId: target, password,
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
  districtId = (await prisma.district.create({ data: { code: fixture, name: '가상 프로필 연결 지구' } })).id;
  for (const suffix of ['a', 'b']) {
    const code = `${fixture}-${suffix}`;
    const local = await prisma.local.create({
      data: { districtId, code, slug: code, name: `가상 프로필 연결 ${suffix}`, verificationState: 'CONFIRMED', serviceEnabled: true },
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
      prisma.localMemberProfileLink.deleteMany({ where: { actedByUserId: userId, localId } }),
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

async function apply(target = localId, phone?: string) {
  const account = await signup(target, phone);
  const response = await app.inject({
    method: 'POST', url: `/api/local/${target}/join-request`, headers: account.headers,
  });
  expect(response.statusCode).toBe(201);
  const membership = await prisma.localMembership.findUniqueOrThrow({
    where: { userId_localId: { userId: account.id, localId: target } },
  });
  return { account, membership };
}

function call(method: 'GET' | 'POST', path: string, payload?: object, actor: Account | null = admin, target = localId) {
  return app.inject({ method, url: `/api/local/${target}/admin/${path}`, payload, headers: actor?.headers });
}

async function createProfile(overrides: Partial<{
  localId: string; phone: string; deletedAt: Date; status: 'SUSPENDED';
}> = {}) {
  const profile = await prisma.memberProfile.create({
    data: {
      localId, name: `가상 수첩 ${fixture}`, memberNumber: `TEST-${fixture}`,
      phone: fixturePhone(), email: 'fixture@example.invalid', birthDate: new Date('1960-01-15'),
      homeAddress: '가상 주소', currentPositionText: '가상 직책', profileImageFileId: randomUUID(),
      ...overrides,
    },
  });
  profileIds.push(profile.id);
  return profile;
}

function membershipFor(account: Account, target = localId) {
  return prisma.localMembership.findUniqueOrThrow({ where: { userId_localId: { userId: account.id, localId: target } } });
}

function profileFor(id: string) {
  return prisma.memberProfile.findUniqueOrThrow({ where: { id, localId } });
}

function evidence(memberProfileId: string) {
  return { memberProfileId, identityVerified: true, verificationNote: '가상 대면 확인' };
}

function expectError(response: { statusCode: number; json(): unknown }, status: number, code: string) {
  expect(response.statusCode).toBe(status);
  expect(response.json()).toMatchObject({ error: { code } });
}

describe('로컬 회원 프로필 연결', () => {
  it('권한, 로컬 범위, 연결 요청과 후보 검색 입력을 검증한다', async () => {
    const membership = await membershipFor(member);
    const foreign = await membershipFor(otherAdmin, otherLocalId);
    const profile = await createProfile();
    const foreignProfile = await createProfile({ localId: otherLocalId });
    const path = `members/${membership.id}`;
    const link = `${path}/profile-link`;
    const payload = evidence(profile.id);
    expectError(await call('POST', link, payload, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('POST', link, payload, otherAdmin), 403, 'LOCAL_NOT_MEMBER');
    expectError(await call('POST', link, payload, otherAdmin, otherLocalId), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', link, payload, null), 401, 'UNAUTHORIZED');
    expectError(await call('POST', `members/${foreign.id}/profile-link`, payload), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', link, evidence(foreignProfile.id)), 404, 'LOCAL_PROFILE_NOT_FOUND');
    expectError(await call('GET', `members/${foreign.id}/profile-link-history`), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');
    expectError(await call('POST', `members/${foreign.id}/profile-unlink`, { reason: '가상 해제' }), 404, 'LOCAL_MEMBERSHIP_NOT_FOUND');

    for (const invalid of [
      { ...payload, identityVerified: undefined },
      { ...payload, identityVerified: false },
      { ...payload, verificationNote: undefined },
      { ...payload, verificationNote: ' ' },
      { ...payload, verificationNote: 'a'.repeat(301) },
      { ...payload, extra: true },
    ]) {
      expect((await call('POST', link, invalid)).statusCode).toBe(400);
    }

    for (const query of ['', '?q=', '?q=%20', `?q=${'a'.repeat(51)}`]) {
      expect((await call('GET', `profile-link-candidates${query}`)).statusCode).toBe(400);
    }
    expect((await call('POST', `${path}/profile-unlink`, { reason: '가상 해제', extra: true })).statusCode).toBe(400);
    expect((await call('POST', `${path}/profile-unlink`, { reason: ' ' })).statusCode).toBe(400);
    expectError(await call('GET', 'profile-link-candidates?q=TEST', undefined, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('GET', `${path}/profile-link-history`, undefined, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('POST', `${path}/profile-unlink`, { reason: '가상 해제' }, member), 403, 'LOCAL_FORBIDDEN');
    expectError(await call('POST', link, evidence((await createProfile({ deletedAt: new Date() })).id)), 404, 'LOCAL_PROFILE_NOT_FOUND');
    expect((await profileFor(profile.id)).userId).toBeNull();
    expect((await membershipFor(member)).memberProfileId).toBeNull();
  });

  it('같은 전화번호여도 가입·승인·로그인으로 연결하지 않고 후보를 이름과 회원번호로만 찾는다', async () => {
    const profile = await createProfile({ phone: fixturePhone() });
    const phone = profile.phone!;
    const inactive = await createProfile({ status: 'SUSPENDED' });
    const deleted = await createProfile({ deletedAt: new Date() });
    const foreign = await createProfile({ localId: otherLocalId });
    const { account, membership } = await apply(localId, phone);
    const verifyUnlinked = async () => {
      expect((await profileFor(profile.id)).userId).toBeNull();
      expect((await membershipFor(account)).memberProfileId).toBeNull();
    };
    await verifyUnlinked();
    expectError(await call('POST', `members/${membership.id}/profile-link`, evidence(profile.id)), 409, 'LOCAL_MEMBER_NOT_ACTIVE');
    expect((await call('POST', `join-requests/${membership.id}/approve`, { memberClass: 'YB' })).statusCode).toBe(200);
    await verifyUnlinked();
    const login = await app.inject({ method: 'POST', url: '/api/gathering/auth/login', payload: { phone, password } });
    expect(login.statusCode).toBe(200);
    await verifyUnlinked();

    for (const q of [phone, '%', '_']) {
      expect((await call('GET', `profile-link-candidates?q=${encodeURIComponent(q)}`)).json()).toEqual({ items: [] });
    }
    const find = async (q: string) => {
      const response = await call('GET', `profile-link-candidates?q=${encodeURIComponent(q)}`);
      expect(response.statusCode).toBe(200);
      return response.json().items as Array<{ memberProfileId: string }>;
    };
    for (const q of ['가상 수첩', `test-${fixture.slice(0, 8)}`]) {
      const items = await find(q);
      expect(items).toContainEqual({
        memberProfileId: profile.id, name: profile.name, memberNumber: profile.memberNumber,
        phoneMasked: `****${phone.slice(-4)}`,
      });
      for (const excluded of [foreign, inactive, deleted]) {
        expect(items.map((item) => item.memberProfileId)).not.toContain(excluded.id);
      }
    }
    expect((await call('POST', `members/${membership.id}/profile-link`, evidence(profile.id))).statusCode).toBe(200);
    expect((await find('가상 수첩')).map((item) => item.memberProfileId)).not.toContain(profile.id);
  });

  it('관리자 본인 연결과 해제를 기록하고 기존 프로필과 직책·사진을 보존한다', async () => {
    const profile = await createProfile();
    const position = await prisma.memberPositionHistory.create({
      data: { memberProfileId: profile.id, localId, note: '가상 직책 이력' },
    });
    const membership = await membershipFor(admin);
    const path = `members/${membership.id}`;
    const link = () => call('POST', `${path}/profile-link`, evidence(profile.id));
    const reason = '가상 연결 해제';
    const unlink = () => call('POST', `${path}/profile-unlink`, { reason });
    const history = async () => (await call('GET', `${path}/profile-link-history`)).json().items;
    expectError(await unlink(), 409, 'LOCAL_PROFILE_NOT_LINKED');

    const linked = await link();
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toEqual({ membership: { id: membership.id, memberProfileId: profile.id } });
    expect((await membershipFor(admin)).memberProfileId).toBe(profile.id);
    expect(await profileFor(profile.id)).toEqual({ ...profile, userId: admin.id });
    expectError(await call('POST', `${path}/profile-link`, evidence((await createProfile()).id)), 409, 'LOCAL_MEMBERSHIP_ALREADY_LINKED');
    expectError(await call('POST', `members/${(await membershipFor(member)).id}/profile-link`, evidence(profile.id)),
      409, 'LOCAL_PROFILE_ALREADY_LINKED');
    const initialHistory = await history();
    expect(initialHistory).toEqual([{
      action: 'LINKED', createdAt: expect.any(String), verificationNote: evidence(profile.id).verificationNote,
      actedByDisplayName: name,
    }]);

    const unlinked = await unlink();
    expect(unlinked.statusCode).toBe(200);
    expect(unlinked.json()).toEqual({ membership: { id: membership.id, memberProfileId: null } });
    expect(await profileFor(profile.id)).toEqual(profile);
    expect((await membershipFor(admin)).memberProfileId).toBeNull();
    expectError(await unlink(), 409, 'LOCAL_PROFILE_NOT_LINKED');
    expect(await history()).toEqual([{
      action: 'UNLINKED', createdAt: expect.any(String), verificationNote: reason, actedByDisplayName: name,
    }, ...initialHistory]);
    expect((await link()).statusCode).toBe(200);
    expect((await history()).map(({ action }: { action: string }) => action)).toEqual(['LINKED', 'UNLINKED', 'LINKED']);
    expect(await profileFor(profile.id)).toEqual({ ...profile, userId: admin.id });
    expect(await prisma.memberPositionHistory.findMany({ where: { memberProfileId: profile.id, localId } })).toEqual([position]);

    const audits = await prisma.auditLog.findMany({ where: { localId, actorUserId: admin.id, targetId: membership.id } });
    expect(audits).toHaveLength(3);
    for (const audit of audits) {
      expect(audit.targetType).toBe('LocalMembership');
      expect(['LOCAL_PROFILE_LINKED', 'LOCAL_PROFILE_UNLINKED']).toContain(audit.action);
      expect(JSON.parse(audit.metaJson!)).toEqual({
        membershipId: membership.id, memberProfileId: profile.id,
        verificationNote: audit.action === 'LOCAL_PROFILE_UNLINKED' ? reason : evidence(profile.id).verificationNote,
      });
    }
  });

  it('동일 프로필 또는 동일 멤버십에 대한 동시 연결을 한 건만 반영한다', async () => {
    const account = await signup();
    const other = await prisma.localMembership.create({ data: { localId, userId: account.id, status: 'ACTIVE' } });
    const first = await membershipFor(member);
    const profile = await createProfile();
    const link = (id: string, profileId: string) => call('POST', `members/${id}/profile-link`, evidence(profileId));
    const race = await Promise.all([link(first.id, profile.id), link(other.id, profile.id)]);
    expect(race.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expectError(race.find(({ statusCode }) => statusCode === 409)!, 409, 'LOCAL_PROFILE_ALREADY_LINKED');
    const saved = [await membershipFor(member), await membershipFor(account)];
    const [winner] = saved.filter(({ memberProfileId }) => memberProfileId === profile.id);
    expect((await profileFor(profile.id)).userId).toBe(winner.userId);
    const [loser] = saved.filter(({ memberProfileId }) => memberProfileId === null);
    const alternatives = [await createProfile(), await createProfile()];
    const secondRace = await Promise.all(alternatives.map(({ id }) => link(loser.id, id)));
    expect(secondRace.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expectError(secondRace.find(({ statusCode }) => statusCode === 409)!, 409, 'LOCAL_MEMBERSHIP_ALREADY_LINKED');
    const profiles = await Promise.all(alternatives.map(({ id }) => profileFor(id)));
    expect(profiles.filter(({ userId }) => userId === loser.userId)).toHaveLength(1);
    expect(profiles.filter(({ userId }) => userId === null)).toHaveLength(1);
    expect(await prisma.localMemberProfileLink.count({
      where: { localId, membershipId: { in: [first.id, other.id] } },
    })).toBe(2);
  });
});
