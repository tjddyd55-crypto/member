import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { STORAGE_QUOTA_BYTES, UPLOAD_INTENT_TTL_MS } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gatheringUploadLimiter } from '../modules/gathering/rate-limit.js';
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
  gatheringUploadLimiter.reset();
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
    payload: {
      name,
      phone,
      password: 'Passw0rd!',
      localJcName: '서울테스트',
      directoryConsent: true,
    },
  });
  expect(res.statusCode).toBe(200);
  userIds.push(res.json().user.id);
  return res.json() as { tokens: { accessToken: string }; user: { id: string } };
}

async function createGroup(token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name },
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
    payload: { requiresApproval: false },
  });
  expect(invite.statusCode).toBe(200);
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/gathering/invites/${invite.json().token}/accept`,
    headers: auth(memberToken),
    payload: { directoryConsent: true },
  });
  expect(accepted.statusCode).toBe(200);
}

async function grantPass(groupId: string, userId: string) {
  const now = new Date();
  await prisma.gatheringSubscription.create({
    data: {
      groupId,
      status: 'ACTIVE',
      source: 'COMPLIMENTARY',
      approvedByUserId: userId,
      approvedAt: now,
      startsAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    },
  });
}

async function createEvent(token: string, groupId: string, startsAt: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/events`,
    headers: auth(token),
    payload: { title: '앨범 행사', startsAt },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
}

describe('행사 사진·영상', () => {
  it('회원은 서명 업로드 뒤 확인해야 목록에 보이고, 다른 모임은 받지 못한다', async () => {
    const owner = await register('사진회장');
    const member = await register('사진회원');
    const outsider = await register('사진외부');
    const group = await createGroup(owner.tokens.accessToken, '사진 모임');
    await createGroup(outsider.tokens.accessToken, '다른 사진 모임');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    await grantPass(group.id, owner.user.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-12-31T15:30:00.000Z');

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(outsider.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(blocked.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32, originalName: '행사.jpg' }] },
    });
    expect(created.statusCode).toBe(200);
    const item = created.json().items[0];
    expect(item.uploadUrl).toContain('https://storage.test/put/');
    expect(item.headers['Content-Length']).toBe('32');
    const stored = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.storageKey).toBe(`test/gatherings/${group.id}/events/${event.id}/photos/${stored.storageKey.split('/').at(-1)}`);
    expect(stored.status).toBe('PENDING');

    const missing = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${item.id}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('OBJECT_MISSING');

    storage.put(`${stored.storageKey}-pending`, jpeg(32));
    const ready = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${item.id}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(ready.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${item.id}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(again.statusCode).toBe(200);
    expect(storage.objects.has(stored.storageKey)).toBe(true);
    expect(storage.objects.has(`${stored.storageKey}-pending`)).toBe(false);
    storage.put(stored.storageKey, jpeg(16));
    const tampered = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${item.id}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(tampered.statusCode).toBe(409);
    expect(tampered.json().error.code).toBe('SIZE_MISMATCH');

    const list = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(list.json().items).toHaveLength(1);
    const download = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/${item.id}/download`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(download.statusCode).toBe(200);
    expect(download.json().url).toContain('https://storage.test/get/');

    const recoveredUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    const recoveredId = recoveredUpload.json().items[0].id as string;
    const recoveredRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: recoveredId } });
    storage.put(recoveredRow.storageKey, jpeg(32));
    const recovered = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${recoveredId}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(recovered.statusCode).toBe(200);
    const recoveredAsset = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: recoveredId } });
    expect(recoveredAsset.status).toBe('READY');
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/${item.id}/download`,
      headers: auth(outsider.tokens.accessToken),
    });
    expect(hidden.statusCode).toBe(404);

    const albums = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/albums?year=2027`,
      headers: auth(member.tokens.accessToken),
    });
    expect(albums.json().events).toHaveLength(1);
    expect(albums.json().years[0].year).toBe(2027);
  });

  it('이용권이 없거나 형식이 다르거나 한도를 넘으면 올리지 못한다', async () => {
    const owner = await register('제한회장');
    const group = await createGroup(owner.tokens.accessToken, '제한 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-06-01T03:00:00.000Z');
    const noPass = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(noPass.statusCode).toBe(403);
    expect(noPass.json().error.code).toBe('SUBSCRIPTION_EXPIRED');

    await grantPass(group.id, owner.user.id);
    const video = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 32, durationMs: 5 * 60 * 1000 + 1 }] },
    });
    expect(video.statusCode).toBe(400);
    expect(video.json().error.code).toBe('VIDEO_TOO_LONG');

    await prisma.gatheringMediaAsset.create({
      data: {
        groupId: group.id,
        eventId: event.id,
        uploaderUserId: owner.user.id,
        kind: 'PHOTO',
        storageKey: `test/gatherings/${group.id}/events/${event.id}/photos/filled`,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(STORAGE_QUOTA_BYTES - 10),
        status: 'READY',
      },
    });
    const quota = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(quota.statusCode).toBe(409);
    expect(quota.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('내용이 다르면 확정을 거절하고, 본인 또는 총무만 지운다', async () => {
    const owner = await register('삭제회장');
    const member = await register('삭제회원');
    const other = await register('삭제다른');
    const group = await createGroup(owner.tokens.accessToken, '삭제 모임');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    await join(owner.tokens.accessToken, other.tokens.accessToken, group.id);
    await grantPass(group.id, owner.user.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-05-01T03:00:00.000Z');
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    const assetId = created.json().items[0].id as string;
    const row = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(`${row.storageKey}-pending`, Buffer.alloc(32, 7));
    const spoofed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${assetId}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(spoofed.statusCode).toBe(415);
    expect(storage.objects.has(`${row.storageKey}-pending`)).toBe(false);

    const retry = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    const secondId = retry.json().items[0].id as string;
    const second = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: secondId } });
    storage.put(`${second.storageKey}-pending`, jpeg(32));
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${secondId}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    const denied = await app.inject({
      method: 'DELETE',
      url: `/api/gathering/groups/${group.id}/media/${secondId}`,
      headers: auth(other.tokens.accessToken),
    });
    expect(denied.statusCode).toBe(403);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/gathering/groups/${group.id}/media/${secondId}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(removed.statusCode).toBe(200);
    expect(storage.objects.has(second.storageKey)).toBe(false);

    await prisma.gatheringMediaAsset.update({
      where: { id: assetId },
      data: { createdAt: new Date(Date.now() - UPLOAD_INTENT_TTL_MS - 1000), status: 'PENDING' },
    });
    storage.put(`${row.storageKey}-pending`, jpeg(32));
    const expired = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${assetId}/complete`,
      headers: auth(member.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe('UPLOAD_EXPIRED');
    expect(storage.objects.has(`${row.storageKey}-pending`)).toBe(false);
  });

  it('신고는 회원이 하고 총무가 처리한다. 저장소가 없으면 503이다', async () => {
    const owner = await register('신고회장');
    const member = await register('신고회원');
    const group = await createGroup(owner.tokens.accessToken, '신고 모임');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const secretary = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(owner.tokens.accessToken),
      payload: { userId: member.user.id, role: 'SECRETARY' },
    });
    expect(secretary.statusCode).toBe(200);
    await grantPass(group.id, owner.user.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-04-01T03:00:00.000Z');
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    const assetId = created.json().items[0].id as string;
    const row = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(`${row.storageKey}-pending`, jpeg(24));
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${assetId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 24 },
    });
    const report = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/media/${assetId}/reports`,
      headers: auth(member.tokens.accessToken),
      payload: { reason: '행사와 관계없는 사진입니다.' },
    });
    expect(report.statusCode).toBe(200);
    const memberList = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/media/reports`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(memberList.statusCode).toBe(200);
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/media/reports/${report.json().id}/resolve`,
      headers: auth(member.tokens.accessToken),
      payload: { status: 'RESOLVED' },
    });
    expect(resolved.statusCode).toBe(200);
    const moderated = await app.inject({
      method: 'DELETE',
      url: `/api/gathering/groups/${group.id}/media/${assetId}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(moderated.statusCode).toBe(200);

    useObjectStorage('unconfigured');
    const unconfigured = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    expect(unconfigured.statusCode).toBe(503);
    expect(unconfigured.json().error.code).toBe('STORAGE_UNCONFIGURED');
  });

  it('인계 전과 중과 후에도 사진 업로드는 되고, 이용권·용량·비회원은 막힌다', async () => {
    const owner = await register('사진인계회장');
    const next = await register('사진차기회장');
    const outsider = await register('사진외부');
    const group = await createGroup(owner.tokens.accessToken, '사진 인계 모임');
    await join(owner.tokens.accessToken, next.tokens.accessToken, group.id);
    await grantPass(group.id, owner.user.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-04-01T03:00:00.000Z');
    const folder = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/folders`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '인계 중 사진' },
    });
    expect(folder.statusCode).toBe(200);

    const reserve = (token = owner.tokens.accessToken) =>
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
        headers: auth(token),
        payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
      });
    const reserveFolder = () =>
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/folders/${folder.json().id}/media/uploads`,
        headers: auth(owner.tokens.accessToken),
        payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
      });

    expect((await reserve()).statusCode).toBe(200);
    const outsiderUpload = await reserve(outsider.tokens.accessToken);
    expect(outsiderUpload.statusCode).toBe(404);
    const noLink = await app.inject({
      method: 'POST',
      url: '/api/gathering/public/uploads/not-a-real-token/reserve',
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(noLink.statusCode).toBe(404);

    const nominated = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
      payload: { toUserId: next.user.id, idempotencyKey: `photo-handover-${group.id}` },
    });
    expect(nominated.statusCode).toBe(200);
    const duringNominate = await reserve();
    expect(duringNominate.statusCode).toBe(200);
    const handoverId = nominated.json().id as string;
    expect(
      (await prisma.gatheringHandover.findUniqueOrThrow({ where: { id: handoverId } })).status,
    ).toBe('NOMINATED');

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/accept`,
      headers: auth(next.tokens.accessToken),
    });
    expect(accepted.statusCode).toBe(200);
    expect((await reserve()).statusCode).toBe(200);
    expect((await reserveFolder()).statusCode).toBe(200);

    const preview = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/confirm`,
      headers: auth(owner.tokens.accessToken),
      payload: preview.json().preview,
    });
    expect(confirmed.statusCode).toBe(200);
    expect((await reserve()).statusCode).toBe(200);

    const link = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { eventId: event.id },
    });
    expect(link.statusCode).toBe(200);
    const guest = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${link.json().token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(guest.statusCode).toBe(200);

    const finalized = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(finalized.statusCode).toBe(200);
    expect((await reserve()).statusCode).toBe(200);
    expect(
      (await prisma.gatheringHandover.findUniqueOrThrow({ where: { id: handoverId } })).status,
    ).toBe('FINALIZED');

    await prisma.gatheringSubscription.updateMany({
      where: { groupId: group.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await reserve();
    expect(expired.statusCode).toBe(403);
    expect(expired.json().error.code).toBe('SUBSCRIPTION_EXPIRED');

    await prisma.gatheringSubscription.updateMany({
      where: { groupId: group.id },
      data: { expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
    });
    await prisma.gatheringMediaAsset.create({
      data: {
        groupId: group.id,
        eventId: event.id,
        uploaderUserId: owner.user.id,
        kind: 'PHOTO',
        storageKey: `test/gatherings/${group.id}/events/${event.id}/photos/full`,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(STORAGE_QUOTA_BYTES - 10),
        status: 'READY',
      },
    });
    const quota = await reserve();
    expect(quota.statusCode).toBe(409);
    expect(quota.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('재시도는 새 예약을 만들지 않고 대기 중인 업로드를 다시 연다', async () => {
    const owner = await register('재시도회장');
    const group = await createGroup(owner.tokens.accessToken, '재시도 모임');
    await grantPass(group.id, owner.user.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-01T03:00:00.000Z');
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    const assetId = created.json().items[0].id as string;
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/media/${assetId}/resume`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().status).toBe('PENDING');
    expect(resumed.json().headers['Content-Length']).toBe('24');
    const count = await prisma.gatheringMediaAsset.count({ where: { eventId: event.id } });
    expect(count).toBe(1);
  });
});

async function cleanup() {
  if (groupIds.length === 0) return;
  await prisma.gatheringMediaReport.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringUploadLink.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaFolder.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceCloseSnapshot.deleteMany({ where: { groupId: { in: groupIds } } });
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
  await prisma.gatheringPushToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
