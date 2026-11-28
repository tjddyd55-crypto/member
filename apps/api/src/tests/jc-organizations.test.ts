import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../services/auth-service.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';
import { seedJcOrganizations, type JcSeedRow } from '../modules/jc-org/seed.js';

const adminBase = '/api/gathering-admin/jc-orgs';
const publicBase = '/api/gathering/jc-orgs';
const key = randomBytes(5).toString('hex');
const password = 'AdminPassw0rd!';
const identity = { birthDate: '1990-01-15', sex: 'FEMALE' } as const;
const districtIds: string[] = [];
const localIds: string[] = [];
const userIds: string[] = [];
const groupIds: string[] = [];
const adminIds: string[] = [];
let app: FastifyInstance;
let adminHeaders: Record<string, string>;

beforeAll(async () => {
  gatheringAuthLimiter.reset();
  app = await buildApp();
  await app.ready();
  const loginId = `org.root.${key}`;
  const admin = await prisma.gatheringAdminAccount.create({
    data: { loginId, role: 'SUPER_ADMIN', passwordHash: await hashPassword(password) },
  });
  adminIds.push(admin.id);
  adminHeaders = await signIn(loginId);
});

afterAll(async () => {
  await prisma.gatheringAuditLog.deleteMany({
    where: { OR: [{ groupId: { in: groupIds } }, { actorUserId: { in: userIds } }] },
  });
  await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringAdminScope.deleteMany({ where: { adminId: { in: adminIds } } });
  await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.localMembership.deleteMany({ where: { userId: { in: userIds }, localId: { in: localIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.jcOrganizationHistory.deleteMany({
    where: { OR: [{ districtId: { in: districtIds } }, { localId: { in: localIds } }] },
  });
  await prisma.jcOrganizationAlias.deleteMany({
    where: { OR: [{ districtId: { in: districtIds } }, { localId: { in: localIds } }] },
  });
  await prisma.local.deleteMany({ where: { id: { in: localIds } } });
  await prisma.district.deleteMany({ where: { id: { in: districtIds } } });
  await prisma.gatheringAdminAudit.deleteMany({
    where: {
      OR: [
        { actorAdminId: { in: adminIds } },
        { targetId: { in: [...districtIds, ...localIds] } },
        { groupId: { in: groupIds } },
      ],
    },
  });
  await prisma.gatheringAdminSession.deleteMany({ where: { adminId: { in: adminIds } } });
  await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: adminIds } } });
  await app?.close();
  await prisma.$disconnect();
});

const phone = () => `010${randomInt(10_000_000, 100_000_000)}`;

async function signIn(loginId: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering-admin/auth/login',
    payload: { loginId, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = response.cookies.find((item) => item.name === 'gathering_admin_session');
  return {
    cookie: `gathering_admin_session=${cookie!.value}`,
    'x-gathering-admin-csrf': response.json().csrfToken as string,
  };
}

async function district(label: string) {
  const name = `${label}${key}지구JC`;
  const response = await app.inject({
    method: 'POST',
    url: `${adminBase}/districts`,
    headers: adminHeaders,
    payload: {
      name,
      displayName: name,
      verificationState: 'CONFIRMED',
      lastVerifiedAt: '2026-11-23',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const org = response.json().district as { id: string; name: string };
  districtIds.push(org.id);
  return org;
}

async function local(districtId: string, name: string, opts: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: `${adminBase}/locals`,
    headers: adminHeaders,
    payload: { districtId, name, displayName: name, verificationState: 'CONFIRMED', ...opts },
  });
  expect(response.statusCode, response.body).toBe(201);
  const org = response.json().local as {
    id: string;
    name: string;
    displayName: string;
    code: string;
    slug: string;
  };
  localIds.push(org.id);
  return org;
}

async function register(
  affiliation: { localId?: string; localJcName?: string },
  expectedStatus = 200,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: {
      name: '조직 테스트',
      phone: phone(),
      password: 'Passw0rd!',
      directoryConsent: true,
      ...identity,
      ...affiliation,
    },
  });
  expect(response.statusCode, response.body).toBe(expectedStatus);
  const data = response.json();
  if (expectedStatus !== 200) return data;
  userIds.push(data.user.id);
  return { ...data, headers: { authorization: `Bearer ${data.tokens.accessToken}` } };
}

async function group(headers: Record<string, string>, scope = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers,
    payload: { name: '조직 테스트 모임', ...scope },
  });
  expect(response.statusCode, response.body).toBe(200);
  const view = response.json();
  groupIds.push(view.id);
  return view;
}

describe('JC organization master data', () => {
  it('creates a district and a local, with immutable member-book identifiers and audited aliases', async () => {
    const parent = await district('등록');
    const org = await local(parent.id, `등록${key}청년회의소`, {
      displayName: `등록${key}JC`,
      approvalNumber: `승인-${key}`,
    });
    const renamed = await app.inject({
      method: 'PATCH',
      url: `${adminBase}/locals/${org.id}`,
      headers: adminHeaders,
      payload: { name: `새 이름${key}청년회의소`, displayName: `새 이름${key}JC` },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().local).toMatchObject({
      id: org.id,
      code: org.code,
      slug: org.slug,
      jcAliases: [{ alias: org.name }],
    });
    const districts = (
      await app.inject({ url: `${adminBase}/districts`, headers: adminHeaders })
    ).json().items;
    expect(districts).toContainEqual(
      expect.objectContaining({ id: parent.id, activeLocalCount: 1, totalLocalCount: 1 }),
    );
    const history = await prisma.jcOrganizationHistory.findMany({ where: { localId: org.id } });
    expect(history.map((item) => item.action)).toEqual(
      expect.arrayContaining(['CREATE', 'RENAME']),
    );
    expect(
      await prisma.gatheringAdminAudit.count({
        where: { targetId: org.id, actorAdminId: adminIds[0] },
      }),
    ).toBe(2);
    const aliasSearch = await app.inject({
      url: `${publicBase}/search?q=${encodeURIComponent(org.name)}`,
    });
    expect(aliasSearch.json().items).toContainEqual(expect.objectContaining({ id: org.id }));
  });

  it('filters public lists by status and verification, and publishes review reasons to super admins', async () => {
    const parent = await district('공개');
    const active = await local(parent.id, `공개${key}`);
    const pending = await local(parent.id, `검토${key}`, {
      verificationState: 'NEEDS_REVIEW',
      reviewReason: '출처 검토',
      sourceUrl: 'https://www.jcikorea.org/',
    });
    const hidden = await local(parent.id, `비활성${key}`);
    const status = await app.inject({
      method: 'POST',
      url: `${adminBase}/locals/${hidden.id}/status`,
      headers: adminHeaders,
      payload: { active: false },
    });
    expect(status.statusCode, status.body).toBe(200);
    const lists = await app.inject({ url: `${publicBase}/districts/${parent.id}/locals` });
    expect(lists.statusCode).toBe(200);
    expect(lists.json().items).toEqual([
      { id: active.id, name: active.name, displayName: active.displayName },
    ]);
    const districts = (await app.inject({ url: `${publicBase}/districts` })).json().items;
    expect(districts).toContainEqual(expect.objectContaining({ id: parent.id, localCount: 1 }));
    const review = (await app.inject({ url: `${adminBase}/review`, headers: adminHeaders })).json()
      .items;
    expect(review).toContainEqual(
      expect.objectContaining({
        id: pending.id,
        reviewReason: '출처 검토',
        sourceUrl: 'https://www.jcikorea.org/',
      }),
    );
    const filtered = await app.inject({
      url: `${adminBase}/locals?districtId=${parent.id}&status=ACTIVE&verification=NEEDS_REVIEW`,
      headers: adminHeaders,
    });
    expect(filtered.json().items).toEqual([expect.objectContaining({ id: pending.id })]);
  });

  it('rejects duplicate normalized names in the same district, alias collisions, and reused approval numbers', async () => {
    const first = await district('중복 첫');
    const other = await district('중복 둘');
    const name = `광주${key}`;
    const approvalNumber = `중복-${key}`;
    const org = await local(first.id, name, { approvalNumber });
    const alias = `광주 별칭${key}`;
    await app.inject({
      method: 'POST',
      url: `${adminBase}/locals/${org.id}/aliases`,
      headers: adminHeaders,
      payload: { alias },
    });
    for (const payload of [
      { name: `${name} JC`, districtId: first.id },
      { name: `${alias}청년회의소`, districtId: first.id },
      { name: `새 로컬${key}`, districtId: other.id, approvalNumber },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `${adminBase}/locals`,
        headers: adminHeaders,
        payload,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('JC_ORG_DUPLICATE');
    }
    const duplicateDistrict = await app.inject({
      method: 'POST',
      url: `${adminBase}/districts`,
      headers: adminHeaders,
      payload: { name: first.name.replace('지구JC', '청년회의소') },
    });
    expect(duplicateDistrict.statusCode).toBe(409);
    await local(other.id, name);
    const ambiguous = await register({ localJcName: name });
    expect(ambiguous.profile).toMatchObject({
      localId: null,
      localJcName: name,
      affiliationNeedsReselect: true,
    });
  });

  it('changes the parent without changing the local ID and records before and after', async () => {
    const first = await district('이전 지구');
    const second = await district('새 지구');
    const org = await local(first.id, `이동${key}`);
    const changed = await app.inject({
      method: 'POST',
      url: `${adminBase}/locals/${org.id}/parent`,
      headers: adminHeaders,
      payload: { districtId: second.id, note: '지구 정정' },
    });
    expect(changed.json().local).toMatchObject({
      id: org.id,
      code: org.code,
      districtId: second.id,
    });
    const history = await app.inject({
      url: `${adminBase}/locals/${org.id}/history`,
      headers: adminHeaders,
    });
    expect(history.json().items).toContainEqual(
      expect.objectContaining({
        action: 'PARENT_CHANGE',
        note: '지구 정정',
        before: expect.objectContaining({ districtId: first.id }),
        after: expect.objectContaining({ districtId: second.id }),
      }),
    );
  });

  it('validates a district change during local edit and records the combined change', async () => {
    const first = await district('수정 첫');
    const second = await district('수정 둘');
    const oldName = `편집 ${key}JC`;
    const nextName = `편집 이동 ${key}JC`;
    const org = await local(first.id, oldName);
    await local(second.id, oldName);
    const edit = (name: string, districtId: string) =>
      app.inject({
        method: 'PATCH',
        url: `${adminBase}/locals/${org.id}`,
        headers: adminHeaders,
        payload: { name, displayName: name, districtId },
      });
    const conflict = await edit(nextName, second.id);
    expect(conflict.statusCode).toBe(409);
    const third = await district('수정 셋');
    const result = await edit(nextName, third.id);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().local).toMatchObject({ id: org.id, name: nextName, districtId: third.id });
    expect(
      await prisma.jcOrganizationHistory.findFirst({
        where: {
          localId: org.id,
          action: 'PARENT_CHANGE',
        },
      }),
    ).toMatchObject({
      before: { name: oldName, districtId: first.id },
      after: { name: nextName, districtId: third.id },
    });
  });

  it('links signup by ID or legacy text and keeps links when a local is deactivated', async () => {
    const parent = await district('가입');
    const org = await local(parent.id, `가입${key}청년회의소`, { displayName: `가입${key}JC` });
    const signup = await register({ localId: org.id });
    expect(signup.profile).toMatchObject({
      localId: org.id,
      localJcName: org.displayName,
      localDisplayName: org.displayName,
      district: { id: parent.id },
      affiliationNeedsReselect: false,
    });
    expect(
      await prisma.gatheringLocalAffiliation.findFirst({ where: { userId: signup.user.id } }),
    ).toMatchObject({ localId: org.id, localJcName: org.displayName, isCurrent: true });
    const legacyName = `가입${key} JC`;
    const legacy = await register({ localJcName: legacyName });
    expect(legacy.profile).toMatchObject({
      localId: org.id,
      localJcName: legacyName,
      localDisplayName: org.displayName,
    });
    const createdGroup = await group(signup.headers);
    await app.inject({
      method: 'POST',
      url: `${adminBase}/locals/${org.id}/status`,
      headers: adminHeaders,
      payload: { active: false },
    });
    const list = await app.inject({ url: `${publicBase}/districts/${parent.id}/locals` });
    expect(list.json().items).toEqual([]);
    const me = await app.inject({ url: '/api/gathering/auth/me', headers: signup.headers });
    expect(me.json().profile).toMatchObject({
      localId: org.id,
      localJcName: org.displayName,
      affiliationNeedsReselect: true,
    });
    const members = await app.inject({
      url: `/api/gathering/groups/${createdGroup.id}/members`,
      headers: signup.headers,
    });
    expect(members.json().items).toContainEqual(
      expect.objectContaining({ localId: org.id, affiliationNeedsReselect: true }),
    );
    expect(await prisma.local.findUnique({ where: { id: org.id } })).toMatchObject({
      isActive: false,
    });
    expect((await register({ localId: org.id }, 400)).error.code).toBe('JC_LOCAL_INVALID');
  });

  it('keeps the original affiliation as a non-current row after changing profile', async () => {
    const legacyName = `이전 소속 ${key}`;
    const signup = await register({ localJcName: legacyName });
    const parent = await district('정보');
    const org = await local(parent.id, `새 소속 ${key}`);
    const updated = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/profile',
      headers: signup.headers,
      payload: { name: '조직 변경', localId: org.id, directoryConsent: true, ...identity },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().profile).toMatchObject({
      localId: org.id,
      localJcName: org.displayName,
      ...identity,
    });
    expect(
      await prisma.gatheringLocalAffiliation.findMany({ where: { userId: signup.user.id } }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ localId: null, localJcName: legacyName, isCurrent: false }),
        expect.objectContaining({ localId: org.id, localJcName: org.displayName, isCurrent: true }),
      ]),
    );
  });

  it('changes local service independently and records each transition once', async () => {
    const parent = await district('서비스');
    const org = await local(parent.id, `서비스${key}JC`);
    const url = `${adminBase}/locals/${org.id}`;
    const toggle = (enabled: boolean, note?: string) =>
      app.inject({
        method: 'PATCH',
        url: `${url}/service`,
        headers: adminHeaders,
        payload: { enabled, note },
      });
    const detail = async () => (await app.inject({ url, headers: adminHeaders })).json().local;
    const setActive = async (active: boolean) => {
      const response = await app.inject({
        method: 'POST',
        url: `${url}/status`,
        headers: adminHeaders,
        payload: { active },
      });
      expect(response.statusCode).toBe(200);
      return response.json().org;
    };
    const list = async (service: 'ENABLED' | 'DISABLED') => {
      const response = await app.inject({
        url: `${adminBase}/locals?districtId=${parent.id}&service=${service}`,
        headers: adminHeaders,
      });
      expect(response.statusCode).toBe(200);
      return response.json().items;
    };
    const signup = await register({ localId: org.id });
    const membership = await prisma.localMembership.create({
      data: { localId: org.id, userId: signup.user.id, status: 'ACTIVE' },
    });
    const ping = () => app.inject({ url: `/api/local/${org.id}/ping`, headers: signup.headers });

    expect(await detail()).toMatchObject({
      isActive: true,
      serviceEnabled: false,
      serviceEnabledAt: null,
    });
    expect(await list('ENABLED')).toEqual([]);
    expect(await list('DISABLED')).toMatchObject([
      { id: org.id, serviceEnabled: false, serviceEnabledAt: null },
    ]);
    expect((await toggle(false)).statusCode).toBe(200);
    expect(await setActive(false)).toMatchObject({ isActive: false, serviceEnabled: false });
    expect((await toggle(true)).statusCode).toBe(409);
    expect(await setActive(true)).toMatchObject({ isActive: true, serviceEnabled: false });

    const [response, retry] = await Promise.all([
      toggle(true, '가상 서비스 시작'),
      toggle(true, '가상 서비스 시작'),
    ]);
    expect(response.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().local.serviceEnabledAt).toBe(response.json().local.serviceEnabledAt);
    const enabled = response.json().local;
    expect(enabled).toMatchObject({
      isActive: true,
      serviceEnabled: true,
      serviceEnabledAt: expect.any(String),
    });
    expect(await detail()).toMatchObject({
      serviceEnabled: true,
      serviceEnabledAt: enabled.serviceEnabledAt,
    });
    const publicList = await app.inject({ url: `${publicBase}/districts/${parent.id}/locals` });
    expect(publicList.statusCode).toBe(200);
    expect(publicList.json().items).toEqual([
      { id: org.id, name: org.name, displayName: org.displayName },
    ]);
    expect(await list('DISABLED')).toEqual([]);
    expect(await list('ENABLED')).toMatchObject([
      { id: org.id, serviceEnabled: true, serviceEnabledAt: enabled.serviceEnabledAt },
    ]);
    expect(await setActive(false)).toMatchObject({
      isActive: false,
      serviceEnabled: true,
      serviceEnabledAt: enabled.serviceEnabledAt,
    });
    expect(await setActive(true)).toMatchObject({
      isActive: true,
      serviceEnabled: true,
      serviceEnabledAt: enabled.serviceEnabledAt,
    });
    const repeated = await toggle(true);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().local).toMatchObject({ serviceEnabledAt: enabled.serviceEnabledAt });
    expect((await ping()).statusCode).toBe(200);

    const disabled = await toggle(false);
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().local).toMatchObject({
      isActive: true,
      serviceEnabled: false,
      serviceEnabledAt: null,
    });
    expect((await toggle(false)).statusCode).toBe(200);
    const denied = await ping();
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('LOCAL_SERVICE_DISABLED');
    expect(await prisma.localMembership.findUnique({ where: { id: membership.id } })).toEqual(
      membership,
    );

    const changes = [
      { before: { serviceEnabled: false }, after: { serviceEnabled: true } },
      { before: { serviceEnabled: true }, after: { serviceEnabled: false } },
    ];
    const history = await prisma.jcOrganizationHistory.findMany({
      where: { localId: org.id, action: 'SERVICE' },
    });
    const audit = await prisma.gatheringAdminAudit.findMany({
      where: { targetId: org.id, action: 'JC_ORG_SERVICE' },
    });
    expect(history).toHaveLength(2);
    expect(audit).toHaveLength(2);
    for (const change of changes) {
      expect(history).toContainEqual(
        expect.objectContaining({ ...change, actorAdminId: adminIds[0] }),
      );
      expect(audit).toContainEqual(
        expect.objectContaining({
          beforeJson: JSON.stringify(change.before),
          afterJson: JSON.stringify(change.after),
          actorAdminId: adminIds[0],
        }),
      );
    }
    expect(history).toContainEqual(
      expect.objectContaining({ ...changes[0], note: '가상 서비스 시작' }),
    );
    expect(audit).toContainEqual(
      expect.objectContaining({
        afterJson: JSON.stringify(changes[0].after),
        reason: '가상 서비스 시작',
      }),
    );
  });

  it('requires a super-admin cookie and CSRF for mutation', async () => {
    const signup = await register({ localJcName: `권한 ${key}` });
    const scopedGroup = await group(signup.headers);
    const loginId = `org.scoped.${key}`;
    const scoped = await app.inject({
      method: 'POST',
      url: '/api/gathering-admin/admins',
      headers: adminHeaders,
      payload: {
        loginId,
        password,
        role: 'ADMIN',
        reason: '권한 테스트',
        scopes: [{ groupId: scopedGroup.id, capability: 'MEMBER_READ' }],
      },
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    adminIds.push(
      (await prisma.gatheringAdminAccount.findUniqueOrThrow({ where: { loginId } })).id,
    );
    const scopedHeaders = await signIn(loginId);
    const parent = await district('서비스권한');
    const org = await local(parent.id, `서비스권한${key}JC`);
    const serviceUrl = `${adminBase}/locals/${org.id}/service`;
    for (const [url, payload, status] of [
      [serviceUrl, { enabled: 'true' }, 400],
      [serviceUrl, { enabled: true, note: 'a'.repeat(501) }, 400],
      [`${adminBase}/locals/${'c00000000000000000000000'}/service`, { enabled: true }, 404],
    ] as const) {
      const response = await app.inject({ method: 'PATCH', url, headers: adminHeaders, payload });
      expect(response.statusCode).toBe(status);
    }
    for (const [headers, status] of [
      [{}, 401],
      [signup.headers, 401],
      [scopedHeaders, 403],
      [{ cookie: adminHeaders.cookie }, 403],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `${adminBase}/districts`,
        headers,
        payload: { name: `권한${key}` },
      });
      expect(response.statusCode, response.body).toBe(status);
      if (headers === scopedHeaders) expect(response.json().error.code).toBe('FORBIDDEN');
      const service = await app.inject({
        method: 'PATCH',
        url: serviceUrl,
        headers,
        payload: { enabled: true },
      });
      expect(service.statusCode, service.body).toBe(status);
    }
    const list = await app.inject({ url: `${adminBase}/review`, headers: scopedHeaders });
    expect(list.statusCode).toBe(403);
  });

  it('stores manual local IDs through mobile and admin endpoints, and keeps group scope optional', async () => {
    const first = await district('범위 첫');
    const second = await district('범위 둘');
    const org = await local(first.id, `범위 ${key}JC`);
    const signup = await register({ localId: org.id });
    const unscoped = await group(signup.headers);
    expect(unscoped).toMatchObject({ scopeDistrictId: null, scopeLocalId: null });
    const scoped = await group(signup.headers, { scopeDistrictId: first.id, scopeLocalId: org.id });
    expect(scoped).toMatchObject({ scopeDistrictId: first.id, scopeLocalId: org.id });
    const patchUrl = `/api/gathering/groups/${scoped.id}`;
    const invalid = await app.inject({
      method: 'PATCH',
      url: patchUrl,
      headers: signup.headers,
      payload: { scopeDistrictId: second.id },
    });
    expect(invalid.statusCode).toBe(400);
    const update = await app.inject({
      method: 'PATCH',
      url: patchUrl,
      headers: signup.headers,
      payload: { scopeDistrictId: null },
    });
    expect(update.json()).toMatchObject({ scopeDistrictId: null, scopeLocalId: org.id });
    const paired = await group(signup.headers, { scopeDistrictId: first.id, scopeLocalId: org.id });
    const move = await app.inject({
      method: 'POST',
      url: `${adminBase}/locals/${org.id}/parent`,
      headers: adminHeaders,
      payload: { districtId: second.id, note: '범위 동기화' },
    });
    expect(move.statusCode, move.body).toBe(200);
    expect(await prisma.gatheringGroup.findUnique({ where: { id: paired.id } })).toMatchObject({
      scopeDistrictId: second.id,
      scopeLocalId: org.id,
    });
    expect(await prisma.gatheringGroup.findUnique({ where: { id: scoped.id } })).toMatchObject({
      scopeDistrictId: null,
      scopeLocalId: org.id,
    });
    const retained = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${paired.id}`,
      headers: signup.headers,
      payload: { scopeLocalId: org.id },
    });
    expect(retained.statusCode, retained.body).toBe(200);
    const payload = { name: '앱 미가입', phone: phone(), localId: org.id, ...identity };
    const manual = await app.inject({
      method: 'POST',
      url: `${patchUrl}/manual-members`,
      headers: signup.headers,
      payload,
    });
    expect(manual.statusCode, manual.body).toBe(200);
    const { membershipId } = manual.json().member;
    expect(manual.json().member).toMatchObject({
      localId: org.id,
      localJcName: org.displayName,
      district: { id: second.id },
    });
    expect(
      await prisma.gatheringMembership.findUnique({ where: { id: membershipId } }),
    ).toMatchObject({
      manualLocalId: org.id,
      manualLocalJcName: org.displayName,
    });
    const newLocal = await local(second.id, `새 범위 ${key}JC`);
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/gathering-admin/groups/${scoped.id}/manual-members/${membershipId}`,
      headers: adminHeaders,
      payload: { ...payload, localId: newLocal.id },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const adminMembers = await app.inject({
      url: `/api/gathering-admin/members?groupId=${scoped.id}`,
      headers: adminHeaders,
    });
    expect(adminMembers.json().items).toContainEqual(
      expect.objectContaining({
        membershipId,
        user: expect.objectContaining({
          localId: newLocal.id,
          localDisplayName: newLocal.displayName,
        }),
      }),
    );
  });

  it('reconciles existing member-book rows and backfills only unambiguous links, with a repeatable preview', async () => {
    const districtName = `시드 지구 ${key}`;
    const localName = `시드 로컬 ${key}`;
    const ambiguousName = `중복 광주 ${key}`;
    const legacyName = `${localName} JC`;
    const districtRecord = await prisma.district.create({
      data: { name: `${districtName}지구`, code: `BOOK-${key}` },
    });
    districtIds.push(districtRecord.id);
    const localRecord = await prisma.local.create({
      data: {
        districtId: districtRecord.id,
        name: `${localName}청년회의소`,
        code: `BOOK-${key}`,
        slug: `book-${key}`,
        officePhone: '02-123-0000',
      },
    });
    localIds.push(localRecord.id);
    const ambiguous = await register({ localJcName: ambiguousName });
    const signup = await register({ localJcName: legacyName });
    const createdGroup = await group(signup.headers);
    const manual = await prisma.gatheringMembership.create({
      data: {
        groupId: createdGroup.id,
        status: 'ACTIVE',
        manualLocalJcName: legacyName,
        manualDisplayName: '수기',
      },
    });
    const entry = (
      row: Partial<JcSeedRow> &
        Pick<JcSeedRow, 'registryKey' | 'type' | 'officialName' | 'displayName'>,
    ): JcSeedRow => ({
      shortName: '',
      parentKey: '',
      status: 'ACTIVE',
      verificationState: 'CONFIRMED',
      reviewReason: '',
      sourceUrl: 'https://www.jcikorea.org/',
      crossCheckUrl: '',
      lastVerifiedAt: '2026-11-23',
      approvalNumber: '',
      aliases: '',
      sortOrder: 1,
      ...row,
    });
    const data = {
      version: key,
      districts: [
        entry({
          registryKey: `A-${key}`,
          type: 'DISTRICT',
          officialName: `${districtName}지구청년회의소`,
          displayName: `${districtName}지구JC`,
        }),
        entry({
          registryKey: `B-${key}`,
          type: 'DISTRICT',
          officialName: `둘째${key}지구JC`,
          displayName: `둘째${key}지구JC`,
        }),
      ],
      locals: [
        entry({
          registryKey: `C-${key}`,
          type: 'LOCAL',
          parentKey: `A-${key}`,
          officialName: localRecord.name,
          displayName: `${localName}JC`,
        }),
        entry({
          registryKey: `D-${key}`,
          type: 'LOCAL',
          parentKey: `A-${key}`,
          officialName: ambiguousName,
          displayName: ambiguousName,
        }),
        entry({
          registryKey: `E-${key}`,
          type: 'LOCAL',
          parentKey: `B-${key}`,
          officialName: ambiguousName,
          displayName: ambiguousName,
        }),
      ],
    };
    const baseline = await seedJcOrganizations(
      prisma,
      { ...data, districts: [], locals: [] },
      { dryRun: true },
    );
    const preview = await seedJcOrganizations(prisma, data, { dryRun: true });
    expect(await prisma.local.findUnique({ where: { id: localRecord.id } })).toMatchObject({
      registryKey: null,
    });
    let first;
    try {
      first = await seedJcOrganizations(prisma, data, { dryRun: false });
    } finally {
      const seededDistricts = await prisma.district.findMany({
        where: { registryKey: { in: data.districts.map((row) => row.registryKey) } },
      });
      const seededLocals = await prisma.local.findMany({
        where: { registryKey: { in: data.locals.map((row) => row.registryKey) } },
      });
      districtIds.push(...seededDistricts.map((row) => row.id));
      localIds.push(...seededLocals.map((row) => row.id));
    }
    expect(first).toEqual(preview);
    expect(first).toMatchObject({
      districts: { created: 1, updated: 1 },
      locals: { created: 2, updated: 1, confirmed: 3 },
      reconciled: 2,
      conflicts: 0,
      affiliation: {
        matched: baseline.affiliation.matched + 1,
        ambiguous: baseline.affiliation.ambiguous + 1,
      },
      manual: { matched: baseline.manual.matched + 1 },
    });
    expect(await prisma.district.findUnique({ where: { registryKey: `A-${key}` } })).toMatchObject({
      id: districtRecord.id,
      code: districtRecord.code,
    });
    expect(await prisma.local.findUnique({ where: { registryKey: `C-${key}` } })).toMatchObject({
      id: localRecord.id,
      code: localRecord.code,
      slug: localRecord.slug,
      officePhone: localRecord.officePhone,
    });
    expect(
      await prisma.gatheringLocalAffiliation.findFirst({ where: { userId: signup.user.id } }),
    ).toMatchObject({ localId: localRecord.id, localJcName: legacyName, isCurrent: true });
    expect(
      await prisma.gatheringLocalAffiliation.findFirst({ where: { userId: ambiguous.user.id } }),
    ).toMatchObject({ localId: null, localJcName: ambiguousName });
    expect(await prisma.gatheringMembership.findUnique({ where: { id: manual.id } })).toMatchObject(
      { manualLocalId: localRecord.id, manualLocalJcName: legacyName },
    );
    const me = await app.inject({ url: '/api/gathering/auth/me', headers: signup.headers });
    expect(me.json().profile).toMatchObject(identity);
    const historyWhere = { actorLabel: `seed:jc-organizations@${key}` };
    expect(await prisma.jcOrganizationHistory.count({ where: historyWhere })).toBe(5);
    const repeat = await seedJcOrganizations(prisma, data, { dryRun: false });
    expect(repeat).toMatchObject({
      districts: { created: 0, updated: 0 },
      locals: { created: 0, updated: 0 },
      aliases: 0,
      reconciled: 0,
      conflicts: 0,
      affiliation: { matched: 0, ambiguous: baseline.affiliation.ambiguous + 1 },
      manual: { matched: 0 },
    });
    expect(await prisma.jcOrganizationHistory.count({ where: historyWhere })).toBe(5);
  });
});
