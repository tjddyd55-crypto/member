import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { currentJobSecret } from '../modules/gathering/routes/schedule.js';
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
  return res.json() as { tokens: { accessToken: string }; user: { id: string } };
}

async function createGroup(token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name: '이용권 모임' },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string };
}

async function createEvent(token: string, groupId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/events`,
    headers: auth(token),
    payload: { title: '이용권 행사', startsAt: '2026-06-01T03:00:00.000Z' },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
}

describe('모임 이용권', () => {
  it('운영자만 수동으로 부여하고, 만료 뒤에는 조회만 되며 파일은 지우지 않는다', async () => {
    const owner = await register('이용회장');
    const group = await createGroup(owner.tokens.accessToken);
    const event = await createEvent(owner.tokens.accessToken, group.id);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    expect(blocked.statusCode).toBe(403);

    const hidden = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: auth(owner.tokens.accessToken),
      payload: { source: 'COMPLIMENTARY', idempotencyKey: 'comp-key-0001' },
    });
    expect(hidden.statusCode).toBe(404);

    const granted = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: 'comp-key-0001', note: '테스트 모임' },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json().source).toBe('COMPLIMENTARY');
    const replay = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: 'comp-key-0001' },
    });
    expect(replay.json().id).toBe(granted.json().id);
    const audits = await prisma.gatheringSubscriptionAudit.count({ where: { groupId: group.id } });
    expect(audits).toBe(1);

    const upload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    expect(upload.statusCode).toBe(200);
    const assetId = upload.json().items[0].id as string;
    const row = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(row.storageKey, jpeg(24));
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${assetId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 24 },
    });

    await prisma.gatheringSubscription.update({
      where: { id: granted.json().id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expiredUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    expect(expiredUpload.statusCode).toBe(403);
    const download = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/${assetId}/download`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(download.statusCode).toBe(200);
    const stillThere = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(stillThere.deletedAt).toBeNull();

    const receipt = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 16 }] },
    });
    expect(receipt.statusCode).toBe(200);

    const renewed = await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'PAID', idempotencyKey: 'paid-key-0002' },
    });
    expect(renewed.statusCode).toBe(200);
    const usage = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/subscription`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(usage.json().uploadsAllowed).toBe(true);
    expect(usage.json().usedBytes).toBeGreaterThan(0);
    expect(usage.json().status).toBe('ACTIVE');
    expect(JSON.stringify(usage.json())).not.toContain('30000');

    await prisma.gatheringSubscription.update({
      where: { id: renewed.json().id },
      data: { expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
    });
    const notices = await app.inject({
      method: 'POST',
      url: '/api/gathering/jobs/subscription-notices',
      headers: { 'x-gathering-job-secret': currentJobSecret() },
    });
    expect(notices.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/gathering/jobs/subscription-notices',
      headers: { 'x-gathering-job-secret': currentJobSecret() },
    });
    const noteCount = await prisma.gatheringNotification.count({
      where: { groupId: group.id, type: 'SUBSCRIPTION_EXPIRING' },
    });
    expect(noteCount).toBe(1);
  });
});

async function cleanup() {
  if (groupIds.length === 0) return;
  await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
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
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
