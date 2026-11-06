import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { fiscalYearOf } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';

let app: FastifyInstance;
const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

type AuthBody = {
  tokens: { accessToken: string; refreshToken: string };
  user: { id: string };
  profile: { displayName: string; localJcName: string } | null;
  recoveryCodes?: string[];
  identityLimitation: string;
};

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  gatheringAuthLimiter.reset();
});

afterAll(async () => {
  await cleanupGatheringData();
  await app.close();
  await prisma.$disconnect();
});

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function register(name: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: {
      name,
      phone,
      password: 'Passw0rd!',
      localJcName: '서울테스트로컬',
      directoryConsent: true,
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as AuthBody;
  createdUserIds.push(body.user.id);
  return { phone, body };
}

async function createGroup(token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: authHeader(token),
    payload: { name, description: `${name} 설명` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { id: string; roles: string[]; financeYear: { year: number } };
  createdGroupIds.push(body.id);
  return body;
}

describe('모임 계정', () => {
  it('비밀번호로 가입하고, 같은 번호는 다시 만들지 않는다', async () => {
    const { phone, body } = await register('김하나');
    expect(body.profile?.displayName).toBe('김하나');
    expect(body.recoveryCodes).toHaveLength(5);
    expect(body.identityLimitation).toContain('문자 인증을 하지 않습니다');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/register',
      payload: {
        name: '김하나',
        phone,
        password: 'Passw0rd!',
        localJcName: '서울테스트로컬',
        directoryConsent: true,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('PHONE_IN_USE');
  });

  it('모임 전용 계정은 회원수첩 로그인에 멤버십이 없다고 답한다', async () => {
    const { phone } = await register('김둘');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: phone, password: 'Passw0rd!' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_MEMBERSHIP');
  });

  it('복구 코드로만 비밀번호를 바꾸고, 검토 요청은 비밀번호를 바꾸지 않는다', async () => {
    const { phone, body } = await register('김셋');
    const code = body.recoveryCodes?.[0];
    expect(code).toBeTruthy();

    const request = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/recovery/request',
      payload: { phone, note: '코드를 분실한 것 같습니다' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/recovery/request',
      payload: { phone: '01099998888' },
    });
    expect(request.statusCode).toBe(200);
    expect(unknown.json().message).toBe(request.json().message);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/login',
      payload: { phone, password: 'Passw0rd!' },
    });
    expect(oldLogin.statusCode).toBe(200);

    const redeem = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/recovery/redeem',
      payload: { phone, recoveryCode: code, newPassword: 'NewPassw0rd!' },
    });
    expect(redeem.statusCode).toBe(200);

    const oldRejected = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/login',
      payload: { phone, password: 'Passw0rd!' },
    });
    expect(oldRejected.statusCode).toBe(401);

    const next = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/login',
      payload: { phone, password: 'NewPassw0rd!' },
    });
    expect(next.statusCode).toBe(200);

    const reused = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/recovery/redeem',
      payload: { phone, recoveryCode: code, newPassword: 'OtherPass1!' },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('회원수첩 토큰과 모임 토큰은 서로 통하지 않는다', async () => {
    const { body } = await register('김넷');
    const book = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: '01000001003', password: 'Passw0rd!' },
    });
    expect(book.statusCode).toBe(200);

    const bookOnGathering = await app.inject({
      method: 'GET',
      url: '/api/gathering/groups',
      headers: authHeader(book.json().tokens.accessToken),
    });
    expect(bookOnGathering.statusCode).toBe(401);

    const gatheringOnBook = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: authHeader(body.tokens.accessToken),
    });
    expect(gatheringOnBook.statusCode).toBe(401);
  });

  it('기존 회원수첩 사용자는 모임 프로필을 채운 뒤에만 모임을 만든다', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/login',
      payload: { phone: '01000001003', password: 'Passw0rd!' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().profile).toBeNull();
    const token = login.json().tokens.accessToken as string;

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: authHeader(token),
      payload: { name: '프로필 없는 모임' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('PROFILE_REQUIRED');

    const profile = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/profile',
      headers: authHeader(token),
      payload: { name: '광진회원', localJcName: '서울광진', directoryConsent: true },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().recoveryCodes).toHaveLength(5);
  });
});

describe('모임 테넌트와 초대', () => {
  it('만든 사람이 회장이 되고 다른 모임 회원은 조회하지 못한다', async () => {
    const owner = await register('회장');
    const outsider = await register('외부인');
    const group = await createGroup(owner.body.tokens.accessToken, '한강 모임');
    expect(group.roles).toContain('PRESIDENT');
    expect(group.financeYear.year).toBe(fiscalYearOf(new Date()));

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}`,
      headers: authHeader(outsider.body.tokens.accessToken),
    });
    expect(foreign.statusCode).toBe(404);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups?groupId=${group.id}`,
      headers: authHeader(outsider.body.tokens.accessToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);
  });

  it('초대 링크는 수락, 만료, 폐기, 중복 참여를 구분한다', async () => {
    const owner = await register('초대회장');
    const guest = await register('손님');
    const group = await createGroup(owner.body.tokens.accessToken, '초대 모임');
    const token = owner.body.tokens.accessToken;

    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(token),
      payload: { expiresInHours: 24, requiresApproval: false },
    });
    expect(created.statusCode).toBe(200);
    const inviteToken = created.json().token as string;
    expect(created.json().link).toBe(`jcikorea://invite/${inviteToken}`);

    const preview = await app.inject({
      method: 'GET',
      url: `/api/gathering/invites/${inviteToken}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().groupName).toBe('초대 모임');

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${inviteToken}/accept`,
      headers: authHeader(guest.body.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('ACTIVE');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${inviteToken}/accept`,
      headers: authHeader(guest.body.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(duplicate.statusCode).toBe(409);

    const again = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(token),
      payload: { expiresInHours: 2 },
    });
    const secondId = again.json().invite.id as string;
    const secondToken = again.json().token as string;
    await prisma.gatheringInvite.update({
      where: { id: secondId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await app.inject({
      method: 'GET',
      url: `/api/gathering/invites/${secondToken}`,
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error.code).toBe('INVITE_EXPIRED');

    const third = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(token),
      payload: { revokeInviteId: secondId },
    });
    expect(third.statusCode).toBe(200);
    const revoked = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${secondToken}/accept`,
      headers: authHeader(guest.body.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(revoked.json().error.code).toBe('INVITE_REVOKED');

    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(token),
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as Array<{ id: string; revokedAt: string | null }>;
    expect(items.some((item) => item.id === secondId && item.revokedAt)).toBe(true);

    const thirdId = third.json().invite.id as string;
    const explicit = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites/${thirdId}/revoke`,
      headers: authHeader(token),
    });
    expect(explicit.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(token),
    });
    const afterItems = after.json().items as Array<{ id: string; revokedAt: string | null }>;
    expect(afterItems.find((item) => item.id === thirdId)?.revokedAt).toBeTruthy();
  });

  it('승인이 필요한 초대는 승인 전에 모임 내부를 열지 않는다', async () => {
    const owner = await register('승인회장');
    const guest = await register('대기손님');
    const group = await createGroup(owner.body.tokens.accessToken, '승인 모임');
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(owner.body.tokens.accessToken),
      payload: { requiresApproval: true },
    });
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: authHeader(guest.body.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(accepted.json().status).toBe('PENDING');

    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}`,
      headers: authHeader(guest.body.tokens.accessToken),
    });
    expect(hidden.statusCode).toBe(403);

    const pending = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/members?status=PENDING`,
      headers: authHeader(owner.body.tokens.accessToken),
    });
    const membershipId = pending.json().items[0].membershipId as string;
    const approved = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/members/${membershipId}/decision`,
      headers: authHeader(owner.body.tokens.accessToken),
      payload: { decision: 'APPROVE' },
    });
    expect(approved.statusCode).toBe(200);

    const visible = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/members`,
      headers: authHeader(guest.body.tokens.accessToken),
    });
    expect(visible.statusCode).toBe(200);
    expect(
      visible.json().items.some((item: { displayName: string }) => item.displayName === '승인회장'),
    ).toBe(true);
  });

  it('역할 변경은 회장만 하고, 다른 모임의 groupId를 본문에 넣어도 현재 모임만 바뀐다', async () => {
    const owner = await register('권한회장');
    const member = await register('일반회원');
    const group = await createGroup(owner.body.tokens.accessToken, '권한 모임');
    const other = await createGroup(owner.body.tokens.accessToken, '다른 모임');
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(owner.body.tokens.accessToken),
      payload: { requiresApproval: false },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: authHeader(member.body.tokens.accessToken),
      payload: { directoryConsent: true },
    });

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/roles`,
      headers: authHeader(member.body.tokens.accessToken),
      payload: { userId: member.body.user.id, role: 'SECRETARY', groupId: other.id },
    });
    expect(forbidden.statusCode).toBe(403);

    const memberInvite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: authHeader(member.body.tokens.accessToken),
      payload: {},
    });
    expect(memberInvite.statusCode).toBe(403);

    const assigned = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/roles`,
      headers: authHeader(owner.body.tokens.accessToken),
      payload: { userId: member.body.user.id, role: 'SECRETARY', groupId: other.id },
    });
    expect(assigned.statusCode).toBe(200);

    const members = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/members`,
      headers: authHeader(owner.body.tokens.accessToken),
    });
    const secretary = members
      .json()
      .items.find((item: { userId: string }) => item.userId === member.body.user.id);
    expect(secretary.roles.some((role: { role: string }) => role.role === 'SECRETARY')).toBe(true);

    const otherMembers = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${other.id}/members`,
      headers: authHeader(owner.body.tokens.accessToken),
    });
    expect(
      otherMembers
        .json()
        .items.some((item: { userId: string }) => item.userId === member.body.user.id),
    ).toBe(false);

    const president = members
      .json()
      .items.find((item: { userId: string }) => item.userId === owner.body.user.id);
    const presidentRole = president.roles.find(
      (role: { role: string }) => role.role === 'PRESIDENT',
    );
    const revoke = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/roles/${presidentRole.id}/revoke`,
      headers: authHeader(owner.body.tokens.accessToken),
      payload: {},
    });
    expect(revoke.statusCode).toBe(403);
    expect(revoke.json().error.code).toBe('PRESIDENT_LOCKED');

    const audit = await prisma.gatheringAuditLog.findFirst({
      where: { groupId: group.id, action: 'GATHERING_ROLE_ASSIGN' },
    });
    expect(audit).toBeTruthy();
  });
});

async function cleanupGatheringData() {
  const seed = await prisma.user.findUnique({ where: { phone: '01000001003' } });
  if (seed) createdUserIds.push(seed.id);
  const owned = await prisma.gatheringGroup.findMany({
    where: { createdByUserId: { in: createdUserIds } },
    select: { id: true },
  });
  const groupIds = [...new Set([...createdGroupIds, ...owned.map((group) => group.id)])];
  if (groupIds.length > 0) {
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringInvite.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  }
  if (createdUserIds.length === 0) return;
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.gatheringRecoveryRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
  const removable = createdUserIds.filter((id) => id !== seed?.id);
  if (removable.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: removable } } });
  }
}
