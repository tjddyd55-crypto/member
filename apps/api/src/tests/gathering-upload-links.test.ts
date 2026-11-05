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
  if (groupIds.length > 0) {
    await prisma.gatheringUploadLink.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringMediaFolder.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
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
  if (userIds.length > 0) {
    await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
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

describe('비회원 업로드 링크와 사진 폴더', () => {
  it('링크는 승인 없이 바로 보이고, 만료·정지·취소·다른 모임은 막는다', async () => {
    const owner = await register('링크회장');
    const member = await register('링크회원');
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(owner.tokens.accessToken),
      payload: { name: '링크 모임' },
    });
    const groupId = groupRes.json().id as string;
    groupIds.push(groupId);
    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: auth(member.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${groupId}/subscription`,
      headers: { ...auth(owner.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: `link-${groupId}` },
    });
    const emptyAlbums = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/albums`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(emptyAlbums.json().events).toHaveLength(0);
    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '정기모임', startsAt: '2026-06-01T03:00:00.000Z' },
    });
    const eventId = event.json().id as string;
    const albums = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/albums`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(albums.json().events.some((item: { eventId: string }) => item.eventId === eventId)).toBe(true);
    const denied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(member.tokens.accessToken),
      payload: { eventId },
    });
    expect(denied.statusCode).toBe(403);
    const link = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { eventId },
    });
    expect(link.statusCode).toBe(200);
    const token = link.json().token as string;
    const page = await app.inject({ method: 'GET', url: `/api/gathering/public/uploads/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('정기모임');
    const bad = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'text/plain', sizeBytes: 32 }] },
    });
    expect(bad.statusCode).toBe(400);
    const huge = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 30_000_000 }] },
    });
    expect(huge.statusCode).toBe(400);
    const reserved = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(reserved.statusCode).toBe(200);
    const assetId = reserved.json().items[0].id as string;
    const row = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(`${row.storageKey}-pending`, jpeg(32));
    const done = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/complete`,
      payload: { assetId, sizeBytes: 32 },
    });
    expect(done.statusCode).toBe(200);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media`,
      headers: auth(member.tokens.accessToken),
    });
    expect(listed.json().items).toHaveLength(1);
    const other = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/complete`,
      payload: { assetId: 'other-asset', sizeBytes: 32 },
    });
    expect(other.statusCode).toBe(404);
    const paused = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links/${link.json().id}/pause`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(paused.statusCode).toBe(200);
    const whilePaused = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(whilePaused.statusCode).toBe(409);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links/${link.json().id}/revoke`,
      headers: auth(owner.tokens.accessToken),
    });
    const revoked = await app.inject({ method: 'GET', url: `/api/gathering/public/uploads/${token}` });
    expect(revoked.statusCode).toBe(404);
    const folder = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '해외 방문' },
    });
    expect(folder.statusCode).toBe(200);
    const folderLink = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { folderId: folder.json().id },
    });
    await prisma.gatheringUploadLink.update({
      where: { id: folderLink.json().id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${folderLink.json().token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(expired.statusCode).toBe(410);
    const shown = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/albums`,
      headers: auth(member.tokens.accessToken),
    });
    expect(shown.json().folders.some((item: { title: string }) => item.title === '해외 방문')).toBe(true);
  });
});
