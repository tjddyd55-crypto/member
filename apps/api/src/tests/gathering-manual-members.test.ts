import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { hash } from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sha256 } from '../modules/gathering/crypto.js';
import { notifyGatheringEvent } from '../modules/gathering/push/service.js';

let app: FastifyInstance;
const users: string[] = [];
const groups: string[] = [];
const admins: string[] = [];
const password = 'ManualPass123!';
const groupPath = (id: string) => `/api/gathering/groups/${id}`;
const manualPath = (id: string) => `${groupPath(id)}/manual-members`;
const newPhone = () => `010${randomInt(10000000, 100000000)}`;
const input = (phone = newPhone()) => ({ name: '  수기 회원  ', phone, localJcName: '  서울JC  ' });
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  const group = { groupId: { in: groups } };
  const user = { userId: { in: users } };
  const admin = { adminId: { in: admins } };
  await prisma.gatheringAdminAudit.deleteMany({ where: { actorAdminId: { in: admins } } });
  await prisma.gatheringAdminSession.deleteMany({ where: admin });
  await prisma.gatheringAdminScope.deleteMany({ where: admin });
  await prisma.gatheringAdminAccount.deleteMany({ where: { id: { in: admins } } });
  await prisma.gatheringNotification.deleteMany({ where: group });
  await prisma.gatheringEventAttendance.deleteMany({ where: group });
  await prisma.gatheringEvent.deleteMany({ where: group });
  await prisma.gatheringAuditLog.deleteMany({
    where: { OR: [group, { actorUserId: { in: users } }] },
  });
  await prisma.gatheringRoleAssignment.deleteMany({ where: group });
  await prisma.gatheringExecutiveTerm.deleteMany({ where: group });
  await prisma.gatheringMemberDue.deleteMany({ where: group });
  await prisma.gatheringInvite.deleteMany({ where: group });
  await prisma.gatheringMembership.deleteMany({ where: group });
  await prisma.gatheringFinanceYear.deleteMany({ where: group });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: group });
  await prisma.gatheringSubscription.deleteMany({ where: group });
  await prisma.gatheringTrialClaim.deleteMany({ where: group });
  await prisma.gatheringGroup.deleteMany({ where: { id: { in: groups } } });
  await prisma.gatheringRecoveryRequest.deleteMany({ where: user });
  await prisma.gatheringRecoveryCode.deleteMany({ where: user });
  await prisma.gatheringSession.deleteMany({ where: user });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: user });
  await prisma.gatheringProfile.deleteMany({ where: user });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await app.close();
  await prisma.$disconnect();
});

function call(method: Method, url: string, token?: string, payload?: object) {
  return app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
}

function ok(response: Awaited<ReturnType<typeof call>>) {
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

function failure(response: Awaited<ReturnType<typeof call>>, status: number, code?: string) {
  expect(response.statusCode, response.body).toBe(status);
  if (code) expect(response.json().error.code).toBe(code);
}

async function register(phone = newPhone()) {
  const result = ok(
    await call('POST', '/api/gathering/auth/register', undefined, {
      name: '앱 가입 회원',
      localJcName: '부산JC',
      phone,
      password,
      directoryConsent: true,
    }),
  );
  users.push(result.user.id);
  return { id: result.user.id as string, token: result.tokens.accessToken as string, phone };
}

async function createGroup(token: string) {
  const result = ok(
    await call('POST', '/api/gathering/groups', token, { name: '앱 미가입 회원 테스트' }),
  );
  groups.push(result.id);
  return { id: result.id as string, year: result.financeYear.year as number };
}

async function createManual(groupId: string, token: string, body: object = input()) {
  const result = ok(await call('POST', manualPath(groupId), token, body));
  return result.member.membershipId as string;
}

async function join(groupId: string, owner: string, account: Awaited<ReturnType<typeof register>>) {
  const invite = ok(
    await call('POST', `${groupPath(groupId)}/invites`, owner, { requiresApproval: false }),
  );
  expect(invite.invite.requiresApproval).toBe(false);
  const result = ok(
    await call('POST', `/api/gathering/invites/${invite.token}/accept`, account.token, {
      directoryConsent: true,
    }),
  );
  const member = await prisma.gatheringMembership.findUniqueOrThrow({
    where: { groupId_userId: { groupId, userId: account.id } },
  });
  return {
    ...member,
    matchedManualMember: result.matchedManualMember,
    responseStatus: result.status,
  };
}

describe('앱 미가입 회원', () => {
  it('requires the signup fields, normalizes phone numbers, searches the directory and releases a withdrawn phone', async () => {
    const owner = await register();
    const { id } = await createGroup(owner.token);
    const phone = newPhone();
    const formatted = `010-${phone.slice(3, 7)}-${phone.slice(7)}`;
    const data = input(formatted);
    for (const field of ['name', 'phone', 'localJcName'] as const) {
      failure(
        await call('POST', manualPath(id), owner.token, { ...data, [field]: undefined }),
        400,
      );
    }
    failure(await call('POST', manualPath(id), owner.token, input('011-1234-1234')), 400);
    failure(
      await call('POST', manualPath(id), owner.token, input(owner.phone)),
      409,
      'PHONE_IN_USE',
    );
    const member = ok(await call('POST', manualPath(id), owner.token, data)).member;
    expect(member).toMatchObject({
      userId: null,
      isAppRegistered: false,
      displayName: '수기 회원',
      phone,
      localJcName: '서울JC',
      status: 'ACTIVE',
    });
    expect(await prisma.user.findUnique({ where: { phone } })).toBeNull();
    expect(
      await prisma.gatheringMembership.findUnique({ where: { id: member.membershipId } }),
    ).toMatchObject({ addedByUserId: owner.id, approvedByUserId: owner.id });
    for (const q of ['수기', '서울jc', phone]) {
      const found = ok(
        await call('GET', `${groupPath(id)}/members?q=${encodeURIComponent(q)}`, owner.token),
      );
      expect(found.items.map((item: { membershipId: string }) => item.membershipId)).toEqual([
        member.membershipId,
      ]);
    }
    failure(
      await call('POST', manualPath(id), owner.token, input(phone)),
      409,
      'MANUAL_MEMBER_EXISTS',
    );
    const url = `${manualPath(id)}/${member.membershipId}`;
    for (const field of ['name', 'phone', 'localJcName'] as const) {
      failure(await call('PATCH', url, owner.token, { ...data, [field]: undefined }), 400);
    }
    failure(await call('PATCH', url, owner.token, input('011-1234-1234')), 400);
    failure(await call('PATCH', url, owner.token, input(owner.phone)), 409, 'PHONE_IN_USE');
    expect(
      ok(await call('PATCH', url, owner.token, { ...data, name: '수정 회원' })).member.displayName,
    ).toBe('수정 회원');
    expect(ok(await call('GET', groupPath(id), owner.token)).memberCount).toBe(2);
    ok(await call('DELETE', url, owner.token));
    failure(await call('DELETE', url, owner.token), 404);
    failure(await call('PATCH', url, owner.token, data), 404);
    expect(ok(await call('GET', groupPath(id), owner.token)).memberCount).toBe(1);
    expect(ok(await call('GET', `${groupPath(id)}/members`, owner.token)).items).toHaveLength(1);
    expect(
      await prisma.gatheringRoleAssignment.count({
        where: { membershipId: member.membershipId, revokedAt: { not: null } },
      }),
    ).toBe(1);
    expect(await createManual(id, owner.token, input(phone))).not.toBe(member.membershipId);
  });

  it('serializes simultaneous adds and gates direct invite acceptance for the same phone', async () => {
    const owner = await register();
    const { id } = await createGroup(owner.token);
    const data = input();
    const [first, second] = await Promise.all([
      call('POST', manualPath(id), owner.token, data),
      call('POST', manualPath(id), owner.token, data),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    failure(first.statusCode === 409 ? first : second, 409, 'MANUAL_MEMBER_EXISTS');
    const account = await register(data.phone);
    const pending = await join(id, owner.token, account);
    expect(pending).toMatchObject({ status: 'PENDING', matchedManualMember: true });
    expect(
      await prisma.gatheringMembership.count({
        where: { groupId: id, userId: null, manualPhone: data.phone, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('enforces group permissions, executive assignment permission and membership scope', async () => {
    const owner = await register();
    const secretary = await register();
    const treasurer = await register();
    const regular = await register();
    const { id } = await createGroup(owner.token);
    const other = await createGroup(owner.token);
    for (const [user, role] of [
      [secretary, 'SECRETARY'],
      [treasurer, 'TREASURER'],
      [regular, 'MEMBER'],
    ] as const) {
      const membership = await join(id, owner.token, user);
      if (role !== 'MEMBER')
        ok(
          await call('POST', `${groupPath(id)}/roles`, owner.token, {
            membershipId: membership.id,
            role,
          }),
        );
    }
    for (const user of [treasurer, regular])
      failure(await call('POST', manualPath(id), user.token, input()), 403, 'FORBIDDEN');
    for (const role of ['SECRETARY', 'TREASURER', 'EXECUTIVE']) {
      failure(
        await call('POST', manualPath(id), secretary.token, { ...input(), role }),
        403,
        'FORBIDDEN',
      );
    }
    const data = input();
    const membershipId = await createManual(id, secretary.token, { ...data, role: 'MEMBER' });
    const foreign = await createManual(other.id, owner.token, data);
    failure(await call('PATCH', `${manualPath(id)}/${foreign}`, owner.token, data), 404);
    failure(await call('DELETE', `${manualPath(id)}/${foreign}`, owner.token), 404);
    const foreignTarget = await join(other.id, owner.token, regular);
    failure(
      await call('POST', `${manualPath(id)}/${membershipId}/link`, secretary.token, {
        targetMembershipId: foreignTarget.id,
      }),
      404,
    );
    const localTarget = await prisma.gatheringMembership.findUniqueOrThrow({
      where: { groupId_userId: { groupId: id, userId: regular.id } },
    });
    ok(
      await call('POST', `${manualPath(id)}/${membershipId}/link`, secretary.token, {
        targetMembershipId: localTarget.id,
      }),
    );
  });

  it('supports manual officers, dues and push delivery without login, recovery or presidential nomination', async () => {
    const owner = await register();
    const { id, year } = await createGroup(owner.token);
    const data = input();
    const membershipId = await createManual(id, owner.token, { ...data, role: 'TREASURER' });
    const executive = ok(
      await call('POST', `${groupPath(id)}/officers`, owner.token, {
        membershipId,
        role: 'EXECUTIVE',
        title: '홍보',
      }),
    );
    const { current } = ok(await call('GET', `${groupPath(id)}/officers`, owner.token));
    expect(current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipId,
          role: 'TREASURER',
          userId: null,
          isAppRegistered: false,
        }),
        expect.objectContaining({
          membershipId,
          role: 'EXECUTIVE',
          title: '홍보',
          displayName: '수기 회원',
        }),
      ]),
    );
    ok(
      await call('POST', `${groupPath(id)}/officers/${executive.assignmentId}/revoke`, owner.token),
    );
    expect(
      await prisma.gatheringExecutiveTerm.findFirst({ where: { membershipId, role: 'EXECUTIVE' } }),
    ).toMatchObject({ endedAt: expect.any(Date) });
    const due = { year, amountWon: 10000, paidAmountWon: 1000 };
    const first = ok(
      await call('POST', `${groupPath(id)}/finance/dues`, owner.token, { ...due, membershipId }),
    );
    const second = ok(
      await call('POST', `${groupPath(id)}/finance/dues`, owner.token, {
        ...due,
        displayName: '수기',
        paidAmountWon: 5000,
      }),
    );
    expect(second.id).toBe(first.id);
    expect(await prisma.gatheringMemberDue.findUnique({ where: { id: first.id } })).toMatchObject({
      membershipId,
      userId: null,
      paidAmountWon: 5000,
    });
    failure(
      await call('POST', `${groupPath(id)}/handover`, owner.token, {
        membershipId,
        idempotencyKey: randomUUID(),
      }),
      409,
      'MANUAL_MEMBER_CANNOT_BE_PRESIDENT',
    );
    failure(
      await call('POST', '/api/gathering/auth/login', undefined, { phone: data.phone, password }),
      401,
    );
    failure(
      await call('POST', '/api/gathering/auth/recovery/redeem', undefined, {
        phone: data.phone,
        recoveryCode: 'ABCDE-FGHIJ-12345',
        newPassword: password,
      }),
      401,
      'INVALID_RECOVERY',
    );
    ok(
      await call('POST', '/api/gathering/auth/recovery/request', undefined, { phone: data.phone }),
    );
    expect(
      await prisma.gatheringRecoveryRequest.count({ where: { phoneHash: sha256(data.phone) } }),
    ).toBe(0);
    const event = ok(
      await call('POST', `${groupPath(id)}/events`, owner.token, {
        title: '정기 모임',
        startsAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const row = await prisma.gatheringEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(await notifyGatheringEvent(row, 'EVENT_REMINDER', owner.id)).toBe(1);
    expect(
      await prisma.gatheringNotification.findMany({
        where: { groupId: id },
        select: { userId: true },
      }),
    ).toEqual([{ userId: owner.id }]);
    ok(await call('DELETE', `${manualPath(id)}/${membershipId}`, owner.token));
    expect(await prisma.gatheringMemberDue.count({ where: { membershipId } })).toBe(1);
    expect(
      await prisma.gatheringExecutiveTerm.count({ where: { membershipId, endedAt: null } }),
    ).toBe(0);
  });

  it('forces approval on a phone match and links the pending account to the original manual record', async () => {
    const owner = await register();
    const { id, year } = await createGroup(owner.token);
    const data = input();
    const membershipId = await createManual(id, owner.token, {
      ...data,
      role: 'EXECUTIVE',
      title: '홍보',
    });
    ok(
      await call('POST', `${groupPath(id)}/finance/dues`, owner.token, {
        year,
        amountWon: 1000,
        paidAmountWon: 0,
        membershipId,
      }),
    );
    const user = await register(data.phone);
    const pending = await join(id, owner.token, user);
    expect(pending).toMatchObject({
      status: 'PENDING',
      responseStatus: 'PENDING',
      matchedManualMember: true,
    });
    failure(await call('GET', groupPath(id), user.token), 403, 'MEMBERSHIP_PENDING');
    const listed = ok(await call('GET', `${groupPath(id)}/members?status=PENDING`, owner.token));
    expect(listed.items).toEqual([
      expect.objectContaining({
        membershipId: pending.id,
        linkCandidate: expect.objectContaining({ membershipId, phone: data.phone }),
      }),
    ]);
    const financeYear = await prisma.gatheringFinanceYear.findFirstOrThrow({
      where: { groupId: id, year },
    });
    const guard = await prisma.gatheringMemberDue.create({
      data: { groupId: id, userId: user.id, financeYearId: financeYear.id, amountWon: 1000 },
    });
    failure(
      await call('POST', `${manualPath(id)}/${membershipId}/link`, owner.token, {
        targetMembershipId: pending.id,
      }),
      409,
      'MEMBER_RECORD_CONFLICT',
    );
    await prisma.gatheringMemberDue.delete({ where: { id: guard.id } });
    expect(
      ok(
        await call('POST', `${manualPath(id)}/${membershipId}/link`, owner.token, {
          targetMembershipId: pending.id,
        }),
      ),
    ).toEqual({ ok: true, membershipId, userId: user.id });
    expect(await prisma.gatheringMembership.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(
      await prisma.gatheringMembership.findUnique({ where: { id: membershipId } }),
    ).toMatchObject({
      status: 'ACTIVE',
      userId: user.id,
      linkedByUserId: owner.id,
      directoryConsentAt: pending.directoryConsentAt,
    });
    expect(
      await prisma.gatheringRoleAssignment.count({
        where: { membershipId, userId: user.id, revokedAt: null },
      }),
    ).toBe(2);
    expect(
      await prisma.gatheringExecutiveTerm.count({ where: { membershipId, userId: user.id } }),
    ).toBe(1);
    expect(
      await prisma.gatheringMemberDue.count({ where: { membershipId, userId: user.id } }),
    ).toBe(1);
    failure(
      await call('PATCH', `${manualPath(id)}/${membershipId}`, owner.token, data),
      409,
      'ALREADY_LINKED',
    );
    failure(
      await call('DELETE', `${manualPath(id)}/${membershipId}`, owner.token),
      409,
      'ALREADY_LINKED',
    );
  });

  it('merges active memberships and rolls back when the registered member has a legacy due for the same year', async () => {
    const owner = await register();
    const user = await register();
    const { id, year } = await createGroup(owner.token);
    const active = await join(id, owner.token, user);
    const manual = await createManual(id, owner.token, { ...input(), role: 'TREASURER' });
    const dues = `${groupPath(id)}/finance/dues`;
    const due = ok(
      await call('POST', dues, owner.token, {
        membershipId: manual,
        year,
        amountWon: 1000,
        paidAmountWon: 0,
      }),
    );
    const legacy = ok(
      await call('POST', dues, owner.token, {
        userId: user.id,
        year,
        amountWon: 1000,
        paidAmountWon: 0,
      }),
    );
    await prisma.gatheringMemberDue.update({
      where: { id: legacy.id },
      data: { membershipId: null },
    });
    const link = `${manualPath(id)}/${manual}/link`;
    const payload = { targetMembershipId: active.id };
    failure(await call('POST', link, owner.token, payload), 409, 'DUE_CONFLICT');
    expect(await prisma.gatheringMembership.findUnique({ where: { id: manual } })).toMatchObject({
      status: 'ACTIVE',
      linkedAt: null,
    });
    await prisma.gatheringMemberDue.delete({ where: { id: legacy.id } });
    expect(ok(await call('POST', link, owner.token, payload))).toMatchObject({
      membershipId: active.id,
      userId: user.id,
    });
    expect(await prisma.gatheringMembership.findUnique({ where: { id: manual } })).toMatchObject({
      status: 'WITHDRAWN',
      linkedAt: expect.any(Date),
    });
    const roles = await prisma.gatheringRoleAssignment.findMany({
      where: { membershipId: active.id, revokedAt: null },
      select: { role: true, userId: true },
    });
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: user.id, role: 'MEMBER' },
        { userId: user.id, role: 'TREASURER' },
      ]),
    );
    expect(
      await prisma.gatheringRoleAssignment.count({
        where: { membershipId: manual, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await prisma.gatheringExecutiveTerm.count({
        where: { membershipId: active.id, userId: user.id },
      }),
    ).toBe(1);
    expect(await prisma.gatheringMemberDue.findUnique({ where: { id: due.id } })).toMatchObject({
      membershipId: active.id,
      userId: user.id,
    });
  });

  it('enforces admin scopes and CSRF, masks phones and audits admin CRUD and link operations', async () => {
    const owner = await register();
    const { id } = await createGroup(owner.token);
    const foreign = await createGroup(owner.token);
    const loginId = `manual.${randomUUID()}`;
    const admin = await prisma.gatheringAdminAccount.create({
      data: { loginId, passwordHash: await hash(password, 10), role: 'ADMIN' },
    });
    admins.push(admin.id);
    const login = await call('POST', '/api/gathering-admin/auth/login', undefined, {
      loginId,
      password,
    });
    const csrf = ok(login).csrfToken as string;
    const cookies = login.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(';')[0] ?? '';
    const base = '/api/gathering-admin';
    const url = `${base}/groups/${id}/manual-members`;
    const request = (method: Method, path: string, payload?: object, withCsrf = true) =>
      app.inject({
        method,
        url: path,
        headers: { cookie, ...(withCsrf ? { 'x-gathering-admin-csrf': csrf } : {}) },
        payload,
      });
    const scope = (capability: string) =>
      prisma.gatheringAdminScope.create({ data: { groupId: id, adminId: admin.id, capability } });
    await scope('MEMBER_READ');
    await scope('GROUP_READ');
    failure(await request('POST', url, input()), 404);
    await scope('MEMBER_WRITE');
    expect(ok(await request('GET', `${base}/groups/${id}`)).canManageMembers).toBe(true);
    failure(await request('POST', url, input(), false), 403);
    failure(await request('POST', `${base}/groups/${foreign.id}/manual-members`, input()), 404);
    const data = input();
    const member = ok(await request('POST', url, { ...data, role: 'TREASURER' })).member;
    expect(member).toMatchObject({ phone: null, isAppRegistered: false, userId: null });
    const memberUrl = `${url}/${member.membershipId}`;
    expect(
      ok(await request('PATCH', memberUrl, { ...data, name: '운영 수정' })).member,
    ).toMatchObject({ displayName: '운영 수정', phone: null });
    const account = await register(data.phone);
    const pending = await join(id, owner.token, account);
    const foreignManual = await createManual(foreign.id, owner.token, data);
    failure(await request('PATCH', `${url}/${foreignManual}`, input()), 404);
    failure(
      await request('POST', `${url}/${foreignManual}/link`, { targetMembershipId: pending.id }),
      404,
    );
    const listUrl = `${base}/members?groupId=${id}`;
    const masked = ok(await request('GET', listUrl)).items;
    expect(masked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isAppRegistered: false,
          user: { id: null, name: '운영 수정', localJcName: '서울JC', phone: null },
        }),
        expect.objectContaining({
          membershipId: pending.id,
          linkCandidate: expect.objectContaining({ phone: null }),
        }),
      ]),
    );
    expect(ok(await request('GET', `${listUrl}&q=${data.phone}`)).items).toEqual([]);
    await scope('CONTACT_READ');
    expect(ok(await request('GET', `${listUrl}&q=${data.phone}`)).items).toHaveLength(2);
    failure(
      await request('POST', `${memberUrl}/link`, { targetMembershipId: pending.id }, false),
      403,
    );
    expect(
      ok(await request('POST', `${memberUrl}/link`, { targetMembershipId: pending.id }))
        .membershipId,
    ).toBe(member.membershipId);
    const unused = ok(await request('POST', url, input())).member;
    failure(await request('DELETE', `${url}/${unused.membershipId}`, undefined, false), 403);
    ok(await request('DELETE', `${url}/${unused.membershipId}`));
    const audits = await prisma.gatheringAdminAudit.findMany({
      where: { groupId: id, actorAdminId: admin.id },
      select: { action: true },
    });
    expect(audits.map(({ action }) => action)).toEqual(
      expect.arrayContaining(
        ['CREATE', 'UPDATE', 'DELETE', 'LINK'].map((action) => `GATHERING_MANUAL_MEMBER_${action}`),
      ),
    );
  });

  it('keeps roster controls and accessibility font scaling wired in both clients', () => {
    const source = (path: string) =>
      readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    const row = source('gathering-mobile/src/features/group/CompactMemberRow.tsx');
    const members = source('gathering-mobile/app/(app)/groups/[groupId]/index.tsx');
    const manage = source('gathering-mobile/app/(app)/groups/[groupId]/manage.tsx');
    const admin = source('gathering-admin/src/screens.tsx');
    expect(row).toContain('앱 미가입');
    expect(row).toMatch(/fontSize:\s*19/);
    expect(row).toMatch(/lineHeight:\s*26/);
    expect(row + members).not.toMatch(/allowFontScaling|maxFontSizeMultiplier/);
    expect(members.match(/minHeight:\s*44/g)?.length).toBeGreaterThanOrEqual(2);
    for (const label of ['앱 미가입 회원 추가', '정보 수정', '앱 계정 연결', '회원 삭제'])
      expect(members).toContain(label);
    expect(manage).toContain('기존 기록에 연결 승인');
    expect(manage).toContain('새 회원으로 승인');
    expect(admin).toContain('MEMBER_WRITE');
    expect(admin).toContain('연결 승인');
  });
});
