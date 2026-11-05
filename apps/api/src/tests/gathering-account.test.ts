import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { currentOperatorSecret } from '../modules/gathering/subscription/service.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';

let app: FastifyInstance;
let storage: MemoryObjectStorage;
const userIds: string[] = [];
const groupIds: string[] = [];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  storage = new MemoryObjectStorage();
  useObjectStorage(storage);
});

afterAll(async () => {
  useObjectStorage('default');
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function jpeg(size: number) {
  const body = Buffer.alloc(size, 1);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  return body;
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
  return { ...res.json(), phone } as {
    tokens: { accessToken: string };
    user: { id: string };
    phone: string;
  };
}

async function createGroup(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name: '삭제 모임' },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string };
}

async function join(ownerToken: string, memberToken: string, groupId: string) {
  const invite = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/invites`,
    headers: auth(ownerToken),
    payload: {},
  });
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/gathering/invites/${invite.json().token}/accept`,
    headers: auth(memberToken),
    payload: { directoryConsent: true },
  });
  expect(accepted.statusCode).toBe(200);
}

describe('계정 삭제와 콘텐츠 처리', () => {
  it('회장은 인계 전에 떠날 수 없고, 일반 계정은 장부를 남긴 채 익명화된다', async () => {
    const owner = await register('삭제회장');
    const member = await register('삭제회원');
    const group = await createGroup(owner.tokens.accessToken);
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '삭제 행사', startsAt: '2026-06-01T03:00:00.000Z' },
    });
    const kept = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.json().id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '보존 회비', amountWon: 1000, paidAt: '2026-06-01T03:00:00.000Z' },
    });
    expect(kept.statusCode).toBe(200);
    const president = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/account/delete',
      headers: auth(owner.tokens.accessToken),
      payload: { password: 'Passw0rd!', confirm: true },
    });
    expect(president.statusCode).toBe(409);
    expect(president.json().error.code).toBe('PRESIDENT_MUST_HANDOVER');

    const removed = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/account/delete',
      headers: auth(member.tokens.accessToken),
      payload: { password: 'Passw0rd!', confirm: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().memberBookKept).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect(user.phone).toBeNull();
    expect(user.status).toBe('DELETED');
    const profile = await prisma.gatheringProfile.findUnique({ where: { userId: member.user.id } });
    expect(profile).toBeNull();
    const ledger = await prisma.gatheringFinanceTransaction.findUniqueOrThrow({ where: { id: kept.json().id } });
    expect(ledger.amountWon).toBe(1000);
    const reused = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(member.tokens.accessToken),
      payload: { name: '탈퇴 후 모임' },
    });
    expect(reused.statusCode).toBe(401);
    const recreated = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/profile',
      headers: auth(member.tokens.accessToken),
      payload: { name: '다시', localJcName: '서울테스트', directoryConsent: true },
    });
    expect(recreated.statusCode).toBe(401);
  });

  it('회원수첩 자격이 있으면 전화번호는 남긴다', async () => {
    const member = await register('수첩회원');
    const local = await prisma.local.findFirstOrThrow();
    await prisma.localMembership.create({
      data: { userId: member.user.id, localId: local.id, status: 'ACTIVE', role: 'MEMBER' },
    });
    const removed = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/account/delete',
      headers: auth(member.tokens.accessToken),
      payload: { password: 'Passw0rd!', confirm: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().memberBookKept).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect(user.phone).toBe(member.phone);
    expect(user.status).toBe('ACTIVE');
    await prisma.localMembership.deleteMany({ where: { userId: member.user.id } });
  });

  it('차단은 연락처와 사진을 가리고, 운영자는 신고를 처리한다', async () => {
    const owner = await register('신고회장');
    const member = await register('신고회원');
    const group = await createGroup(owner.tokens.accessToken);
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: `acct-${group.id}` },
    });
    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '신고 행사', startsAt: '2026-06-02T03:00:00.000Z' },
    });
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.json().id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24, originalName: 'face.jpg' }] },
    });
    const assetId = uploaded.json().items[0].id as string;
    const row = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(row.storageKey, jpeg(24));
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.json().id}/media/${assetId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 24 },
    });
    const report = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/media/${assetId}/reports`,
      headers: auth(member.tokens.accessToken),
      payload: { reason: '모임과 관계없는 사진입니다.' },
    });
    expect(report.statusCode).toBe(200);
    const queue = await app.inject({
      method: 'GET',
      url: '/api/gathering/admin/reports',
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items.some((item: { id: string }) => item.id === report.json().id)).toBe(true);
    const reviewing = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/reports/${report.json().id}/resolve`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { status: 'REVIEWING' },
    });
    expect(reviewing.statusCode).toBe(200);
    const stillQueued = await app.inject({
      method: 'GET',
      url: '/api/gathering/admin/reports',
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
    });
    expect(
      stillQueued.json().items.some((item: { id: string; status: string }) => item.id === report.json().id && item.status === 'REVIEWING'),
    ).toBe(true);
    const groupQueue = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/reports`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(groupQueue.json().items.some((item: { id: string }) => item.id === report.json().id)).toBe(true);
    const hidden = await app.inject({
      method: 'GET',
      url: '/api/gathering/admin/reports',
      headers: auth(member.tokens.accessToken),
    });
    expect(hidden.statusCode).toBe(404);
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/reports/${report.json().id}/resolve`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { status: 'RESOLVED' },
    });
    expect(resolved.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/blocks`,
      headers: auth(member.tokens.accessToken),
      payload: { userId: owner.user.id },
    });
    expect(blocked.statusCode).toBe(200);
    const roster = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/members?status=ACTIVE`,
      headers: auth(member.tokens.accessToken),
    });
    const presidentRow = roster.json().items.find((item: { userId: string }) => item.userId === owner.user.id);
    expect(presidentRow.phone).toBeNull();
    const album = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events/${event.json().id}/media`,
      headers: auth(member.tokens.accessToken),
    });
    expect(album.json().items).toHaveLength(0);
    const albums = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/albums`,
      headers: auth(member.tokens.accessToken),
    });
    expect(albums.statusCode).toBe(200);
    expect(albums.json().events.every((card: { photoCount: number }) => card.photoCount === 0)).toBe(true);
    const download = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/${assetId}/download`,
      headers: auth(member.tokens.accessToken),
    });
    expect(download.statusCode).toBe(404);

    const membership = await prisma.gatheringMembership.findUniqueOrThrow({
      where: { groupId_userId: { groupId: group.id, userId: member.user.id } },
    });
    const suspended = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/memberships/${membership.id}/suspend`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
    });
    expect(suspended.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(denied.statusCode).toBe(403);
  });
});

async function cleanup() {
  if (groupIds.length > 0) {
    await prisma.gatheringMemberBlock.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaReport.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringEventAttendance.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringEvent.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringInvite.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  }
  if (userIds.length === 0) return;
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringMemberBlock.deleteMany({
    where: { OR: [{ blockerUserId: { in: userIds } }, { blockedUserId: { in: userIds } }] },
  });
  await prisma.localMembership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
