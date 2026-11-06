import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';

let app: FastifyInstance;
const userIds: string[] = [];
const groupIds: string[] = [];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  gatheringAuthLimiter.reset();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

function auth(token: string) {
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
      localJcName: '서울테스트',
      directoryConsent: true,
    },
  });
  expect(res.statusCode).toBe(200);
  userIds.push(res.json().user.id as string);
  return res.json() as { tokens: { accessToken: string; refreshToken: string }; user: { id: string } };
}

async function createGroup(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name: '정지 검증 모임' },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id as string);
  return res.json() as { id: string };
}

describe('리뷰 수정', () => {
  it('정지된 멤버십은 초대로 다시 활성화되지 않는다', async () => {
    const owner = await register('정지회장');
    const member = await register('정지회원');
    const group = await createGroup(owner.tokens.accessToken);
    const first = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: { requiresApproval: false },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${first.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    await prisma.gatheringMembership.update({
      where: { groupId_userId: { groupId: group.id, userId: member.user.id } },
      data: { status: 'SUSPENDED' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: { requiresApproval: false, maxUses: 1 },
    });
    const retried = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${second.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(retried.statusCode).toBe(403);
    expect(retried.json().error.code).toBe('MEMBERSHIP_SUSPENDED');
    const membership = await prisma.gatheringMembership.findUniqueOrThrow({
      where: { groupId_userId: { groupId: group.id, userId: member.user.id } },
    });
    expect(membership.status).toBe('SUSPENDED');
    const invite = await prisma.gatheringInvite.findUniqueOrThrow({ where: { id: second.json().invite.id as string } });
    expect(invite.useCount).toBe(0);
  });

  it('비밀번호 재설정은 회원수첩 리프레시도 폐기하고 새 비밀번호 로그인은 남긴다', async () => {
    const seed = await prisma.user.findUniqueOrThrow({ where: { phone: '01000001003' } });
    const originalHash = seed.passwordHash;
    const membership = await prisma.localMembership.findFirstOrThrow({
      where: { userId: seed.id, status: 'ACTIVE' },
    });
    try {
      const book = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: '01000001003', password: 'Passw0rd!' },
      });
      expect(book.statusCode).toBe(200);
      const gathering = await app.inject({
        method: 'POST',
        url: '/api/gathering/auth/login',
        payload: { phone: '01000001003', password: 'Passw0rd!' },
      });
      expect(gathering.statusCode).toBe(200);
      const profile = await app.inject({
        method: 'POST',
        url: '/api/gathering/auth/profile',
        headers: auth(gathering.json().tokens.accessToken as string),
        payload: { name: '광진회원', localJcName: '서울광진', directoryConsent: true },
      });
      expect(profile.statusCode).toBe(200);
      const code = profile.json().recoveryCodes[0] as string;
      const redeemed = await app.inject({
        method: 'POST',
        url: '/api/gathering/auth/recovery/redeem',
        payload: { phone: '01000001003', recoveryCode: code, newPassword: 'ResetPass1!' },
      });
      expect(redeemed.statusCode).toBe(200);

      const staleBook = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: book.json().tokens.refreshToken },
      });
      expect(staleBook.statusCode).toBe(401);
      const staleGathering = await app.inject({
        method: 'POST',
        url: '/api/gathering/auth/refresh',
        payload: { refreshToken: gathering.json().tokens.refreshToken },
      });
      expect(staleGathering.statusCode).toBe(401);

      const relogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: '01000001003', password: 'ResetPass1!' },
      });
      expect(relogin.statusCode).toBe(200);
      expect(relogin.json().membership.role).toBe(membership.role);
      expect(relogin.json().membership.localId).toBe(membership.localId);
      const oldPassword = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier: '01000001003', password: 'Passw0rd!' },
      });
      expect(oldPassword.statusCode).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: seed.id }, data: { passwordHash: originalHash } });
      await prisma.refreshSession.updateMany({
        where: { userId: seed.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.gatheringSession.deleteMany({ where: { userId: seed.id } });
      await prisma.gatheringRecoveryRequest.deleteMany({ where: { userId: seed.id } });
      await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: seed.id } });
      await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: seed.id } });
      await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: seed.id, groupId: null } });
      await prisma.gatheringProfile.deleteMany({ where: { userId: seed.id } });
    }
  });
});

async function cleanup() {
  if (groupIds.length === 0) return;
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
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
