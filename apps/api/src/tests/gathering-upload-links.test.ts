import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { currentOperatorSecret } from '../modules/gathering/subscription/service.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';
import {
  gatheringAuthLimiter,
  gatheringPublicGalleryLimiter,
  gatheringUploadLimiter,
} from '../modules/gathering/rate-limit.js';
import { publicUploadInfo } from '../modules/gathering/media/links.js';

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
  gatheringAuthLimiter.reset();
  storage = new MemoryObjectStorage();
  useObjectStorage(storage);
  gatheringUploadLimiter.reset();
  gatheringPublicGalleryLimiter.reset();
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

function publicGet(token: string, path = '') {
  return app.inject({ method: 'GET', url: `/api/gathering/public/uploads/${token}${path}` });
}

async function expectUnavailable(token: string, assetId: string, status: number, code: string) {
  const [page, list, download] = await Promise.all([
    publicGet(token),
    publicGet(token, '/media'),
    publicGet(token, `/media/${assetId}`),
  ]);
  expect(page.statusCode).toBe(status);
  expect(page.headers['content-type']).toContain('text/html');
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.body).toContain('class="link-error"');
  for (const response of [list, download]) {
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(page.body).toContain(response.json().error.message);
  }
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
      headers: {
        ...auth(owner.tokens.accessToken),
        'x-gathering-operator-secret': currentOperatorSecret(),
      },
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
    expect(albums.json().events.some((item: { eventId: string }) => item.eventId === eventId)).toBe(
      true,
    );
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
    const notice =
      '이 링크는 사진과 영상을 올리고 이 일정의 사진을 볼 수 있습니다. 회원 명부와 재무는 볼 수 없습니다.';
    expect(await publicUploadInfo(token)).toMatchObject({ kind: 'event', notice });
    for (const content of [
      '정기모임',
      notice,
      '사진 올리기',
      '영상 올리기',
      '#1B3A6B',
      '#E8EEF7',
      '등록된 사진이 없습니다',
      'onloadedmetadata',
      'durationMs',
      'id="grid"',
      'id="viewer"',
    ])
      expect(page.body).toContain(content);
    for (const content of [
      '이미 올린 파일은 볼 수 없습니다',
      '업로드 링크',
      't1.daumcdn.net',
      'id="go"',
    ])
      expect(page.body).not.toContain(content);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect((await publicGet(token, '/media')).json()).toEqual({ items: [], nextCursor: null });
    const videoMissing = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 32 }] },
    });
    expect(videoMissing.statusCode).toBe(400);
    expect(videoMissing.json().error.code).toBe('DURATION_REQUIRED');
    const videoReady = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: {
        items: [{ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 32, durationMs: 1000 }],
      },
    });
    expect(videoReady.statusCode).toBe(200);
    const videoId = videoReady.json().items[0].id as string;
    expect((await publicGet(token, '/media')).json().items).toEqual([]);
    expect((await publicGet(token, `/media/${videoId}`)).statusCode).toBe(404);
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
    expect(done.json().media).not.toHaveProperty('uploaderUserId');
    expect(done.json().media).not.toHaveProperty('mine');
    const photoDownload = await publicGet(token, `/media/${assetId}`);
    expect(photoDownload.statusCode).toBe(200);
    expect(photoDownload.json()).toEqual({
      url: expect.stringContaining('https://storage.test/get/'),
      posterUrl: null,
      expiresAt: expect.any(String),
      mimeType: 'image/jpeg',
      kind: 'PHOTO',
    });
    const video = await prisma.gatheringMediaAsset.update({
      where: { id: videoId },
      data: {
        status: 'READY',
        createdAt: new Date('2026-01-02T00:00:00Z'),
        posterStorageKey: `test/posters/${videoId}`,
      },
    });
    const sign = vi.spyOn(storage, 'presignGet');
    const videoDownload = await publicGet(token, `/media/${videoId}`);
    expect(videoDownload.statusCode).toBe(200);
    expect(videoDownload.json()).toEqual({
      url: expect.stringContaining('https://storage.test/get/'),
      posterUrl: expect.stringContaining('https://storage.test/get/'),
      expiresAt: expect.any(String),
      mimeType: 'video/mp4',
      kind: 'VIDEO',
    });
    for (const key of [video.storageKey, video.posterStorageKey]) {
      expect(sign).toHaveBeenCalledWith({ key, expiresInSeconds: 600 });
    }
    sign.mockRestore();
    const publicList = await publicGet(token, '/media');
    expect(publicList.statusCode).toBe(200);
    expect(publicList.headers['cache-control']).toBe('no-store');
    expect(publicList.json()).toEqual({
      items: [
        { id: assetId, kind: 'PHOTO', canDelete: false, createdAt: expect.any(String) },
        { id: videoId, kind: 'VIDEO', canDelete: false, createdAt: expect.any(String) },
      ],
      nextCursor: null,
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media`,
      headers: auth(member.tokens.accessToken),
    });
    expect(listed.json().items).toHaveLength(2);
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
    await expectUnavailable(token, assetId, 409, 'LINK_PAUSED');
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links/${link.json().id}/revoke`,
      headers: auth(owner.tokens.accessToken),
    });
    await expectUnavailable(token, assetId, 404, 'LINK_NOT_FOUND');
    await expectUnavailable('unknown-token', assetId, 404, 'LINK_NOT_FOUND');
    expect((await publicGet('')).statusCode).toBe(404);
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
    await expectUnavailable(folderLink.json().token, assetId, 410, 'LINK_EXPIRED');
    const shown = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/albums`,
      headers: auth(member.tokens.accessToken),
    });
    expect(shown.json().folders.some((item: { title: string }) => item.title === '해외 방문')).toBe(
      true,
    );
    const liveFolderLink = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { folderId: folder.json().id },
    });
    const folderToken = liveFolderLink.json().token as string;
    const folderPage = await publicGet(folderToken);
    expect(folderPage.statusCode).toBe(200);
    expect(folderPage.body).toContain('해외 방문');
    expect(folderPage.body).toContain('아직 올린 사진·영상이 없습니다');
    expect(folderPage.body).toContain('이 폴더의 사진을 볼 수 있습니다.');
    expect((await publicGet(folderToken, `/media?eventId=${eventId}`)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    const folderReserved = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${liveFolderLink.json().token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(folderReserved.statusCode).toBe(200);
    const folderAssetId = folderReserved.json().items[0].id as string;
    const folderRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({
      where: { id: folderAssetId },
    });
    storage.put(`${folderRow.storageKey}-pending`, jpeg(32));
    const folderDone = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${liveFolderLink.json().token}/complete`,
      payload: { assetId: folderAssetId, sizeBytes: 32 },
    });
    expect(folderDone.statusCode).toBe(200);
    expect((await publicGet(folderToken, '/media')).json().items).toEqual([
      { id: folderAssetId, kind: 'PHOTO', canDelete: false, createdAt: expect.any(String) },
    ]);
    expect((await publicGet(folderToken, `/media/${folderAssetId}`)).statusCode).toBe(200);
    expect((await publicGet(folderToken, `/media/${assetId}?eventId=${eventId}`)).statusCode).toBe(
      404,
    );
    const folderMedia = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/folders/${folder.json().id}/media`,
      headers: auth(member.tokens.accessToken),
    });
    expect(folderMedia.statusCode).toBe(200);
    expect(folderMedia.json().items).toHaveLength(1);
    const outsider = await register('다른모임');
    const otherGroup = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(outsider.tokens.accessToken),
      payload: { name: '다른 모임' },
    });
    groupIds.push(otherGroup.json().id as string);
    const hiddenFolder = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${otherGroup.json().id}/folders/${folder.json().id}/media`,
      headers: auth(outsider.tokens.accessToken),
    });
    expect(hiddenFolder.statusCode).toBe(404);

    const otherFolder = await prisma.gatheringMediaFolder.create({
      data: { groupId, title: '다른 폴더', createdByUserId: owner.user.id },
    });
    const secondEvent = await prisma.gatheringEvent.create({
      data: {
        groupId,
        title: '다른 행사',
        startsAt: new Date(),
        createdByUserId: owner.user.id,
      },
    });
    const outsiderGroupId = otherGroup.json().id as string;
    const foreignFolder = await prisma.gatheringMediaFolder.create({
      data: {
        groupId: outsiderGroupId,
        title: '다른 모임 폴더',
        createdByUserId: outsider.user.id,
      },
    });
    const fixture = {
      groupId,
      kind: 'PHOTO' as const,
      status: 'READY' as const,
      uploaderUserId: owner.user.id,
      sizeBytes: 32n,
      mimeType: 'image/jpeg',
    };
    const outside = await Promise.all([
      prisma.gatheringMediaAsset.create({
        data: { ...fixture, folderId: otherFolder.id, storageKey: `test/${otherFolder.id}` },
      }),
      prisma.gatheringMediaAsset.create({
        data: { ...fixture, eventId: secondEvent.id, storageKey: `test/${secondEvent.id}` },
      }),
      prisma.gatheringMediaAsset.create({
        data: {
          ...fixture,
          groupId: outsiderGroupId,
          uploaderUserId: outsider.user.id,
          folderId: foreignFolder.id,
          storageKey: `test/${foreignFolder.id}`,
        },
      }),
      prisma.gatheringMediaAsset.create({
        data: {
          ...fixture,
          folderId: folder.json().id,
          deletedAt: new Date(),
          storageKey: `test/deleted/${folderAssetId}`,
        },
      }),
    ]);
    const eventLink = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { eventId },
    });
    const eventToken = eventLink.json().token as string;
    for (const outsiderAsset of outside) {
      expect((await publicGet(folderToken, `/media/${outsiderAsset.id}`)).statusCode).toBe(404);
      expect((await publicGet(eventToken, `/media/${outsiderAsset.id}`)).statusCode).toBe(404);
    }
    expect((await publicGet(eventToken, `/media/${folderAssetId}`)).statusCode).toBe(404);
    expect(
      (
        await publicGet(
          folderToken,
          `/media?groupId=${outsiderGroupId}&folderId=${foreignFolder.id}`,
        )
      ).json().items,
    ).toEqual([
      { id: folderAssetId, kind: 'PHOTO', canDelete: false, createdAt: expect.any(String) },
    ]);

    await prisma.gatheringMediaAsset.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        ...fixture,
        eventId,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        storageKey: `test/${eventId}/pagination/${index}`,
      })),
    });
    const first = await publicGet(eventToken, `/media?eventId=${secondEvent.id}&limit=1`);
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(30);
    const authenticatedFirst = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media`,
      headers: auth(member.tokens.accessToken),
    });
    expect(first.json().nextCursor).toBe(authenticatedFirst.json().nextCursor);
    const second = await publicGet(eventToken, `/media?cursor=${first.json().nextCursor}`);
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(2);
    expect(second.json().nextCursor).toBeNull();
    const ids = [...first.json().items, ...second.json().items].map((item) => item.id);
    expect(new Set(ids).size).toBe(32);
    for (const outsiderAsset of outside) expect(ids).not.toContain(outsiderAsset.id);
    expect((await publicGet(eventToken, '/media?cursor=bad')).statusCode).toBe(400);
  });

  it('손님 업로드는 만든 사람의 업로드 횟수를 쓰지 않는다', async () => {
    const owner = await register('제한회장');
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(owner.tokens.accessToken),
      payload: { name: '제한 모임' },
    });
    const groupId = groupRes.json().id as string;
    groupIds.push(groupId);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${groupId}/subscription`,
      headers: {
        ...auth(owner.tokens.accessToken),
        'x-gathering-operator-secret': currentOperatorSecret(),
      },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: `limit-${groupId}` },
    });
    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '제한 행사', startsAt: '2026-06-01T03:00:00.000Z' },
    });
    const link = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { eventId: event.json().id },
    });
    for (let index = 0; index < 30; index += 1) {
      const reserved = await app.inject({
        method: 'POST',
        url: `/api/gathering/public/uploads/${link.json().token}/reserve`,
        payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
      });
      expect(reserved.statusCode).toBe(200);
    }
    const memberUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${event.json().id}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(memberUpload.statusCode).toBe(200);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${link.json().token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('폴더 링크 목록은 그 폴더만 보여 주고 회원은 볼 수 없다', async () => {
    const owner = await register('목록회장');
    const member = await register('목록회원');
    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(owner.tokens.accessToken),
      payload: { name: '목록 모임' },
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
    const folder = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '행사 뒤풀이' },
    });
    const other = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '다른 폴더' },
    });
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { folderId: folder.json().id },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { folderId: other.json().id },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/upload-links?folderId=${folder.json().id}`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].id).toBe(created.json().id);
    expect(listed.json().items[0].token).toBeUndefined();
    expect(listed.json().items[0].expiresAt).toEqual(expect.any(String));
    const hidden = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/upload-links?folderId=${folder.json().id}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(hidden.statusCode).toBe(403);
    for (let index = 0; index < 20; index += 1) {
      const extra = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${groupId}/upload-links`,
        headers: auth(owner.tokens.accessToken),
        payload: { folderId: folder.json().id },
      });
      expect(extra.statusCode).toBe(200);
    }
    const many = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/upload-links?folderId=${folder.json().id}`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(many.json().items).toHaveLength(21);
    await prisma.gatheringUploadLink.update({
      where: { id: created.json().id },
      data: { revokedAt: new Date() },
    });
    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/upload-links?folderId=${folder.json().id}`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(afterRevoke.json().items).toHaveLength(20);
    expect(
      afterRevoke.json().items.some((item: { id: string }) => item.id === created.json().id),
    ).toBe(false);
  });
  it('회장·총무만 폴더를 수정·삭제하고 행사·다른 그룹·삭제된 폴더는 보호한다', async () => {
    const owner = await register('폴더회장');
    const secretary = await register('폴더총무');
    const member = await register('폴더회원');
    const createGroup = async (name: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/gathering/groups',
        headers: auth(owner.tokens.accessToken),
        payload: { name },
      });
      expect(res.statusCode).toBe(200);
      groupIds.push(res.json().id);
      return res.json().id as string;
    };
    const groupId = await createGroup('폴더 관리');
    const otherGroupId = await createGroup('폴더 다른 모임');
    for (const user of [secretary, member]) {
      const invite = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${groupId}/invites`,
        headers: auth(owner.tokens.accessToken),
        payload: { requiresApproval: false },
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/gathering/invites/${invite.json().token}/accept`,
            headers: auth(user.tokens.accessToken),
            payload: { directoryConsent: true },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/gathering/groups/${groupId}/officers`,
          headers: auth(owner.tokens.accessToken),
          payload: { userId: secretary.user.id, role: 'SECRETARY' },
        })
      ).statusCode,
    ).toBe(200);
    const createFolder = (token: string) =>
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${groupId}/folders`,
        headers: auth(token),
        payload: { title: '번개' },
      });
    expect((await createFolder(member.tokens.accessToken)).statusCode).toBe(403);
    const folder = await createFolder(secretary.tokens.accessToken);
    expect(folder.statusCode).toBe(200);
    const folderId = folder.json().id as string;
    const manage = (token: string, method: 'POST' | 'DELETE', id = folderId, group = groupId) =>
      app.inject({
        method,
        url: `/api/gathering/groups/${group}/folders/${id}`,
        headers: auth(token),
        ...(method === 'POST' ? { payload: { title: '바뀐 이름' } } : {}),
      });
    for (const method of ['POST', 'DELETE'] as const) {
      expect((await manage(member.tokens.accessToken, method)).statusCode).toBe(403);
      expect(
        (await manage(owner.tokens.accessToken, method, folderId, otherGroupId)).statusCode,
      ).toBe(404);
    }
    for (const user of [owner, secretary])
      expect((await manage(user.tokens.accessToken, 'POST')).statusCode).toBe(200);
    const eventRes = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '자동 앨범', startsAt: '2026-06-01T03:00:00.000Z' },
    });
    expect(eventRes.statusCode).toBe(200);
    for (const method of ['POST', 'DELETE'] as const)
      expect((await manage(owner.tokens.accessToken, method, eventRes.json().id)).statusCode).toBe(
        404,
      );
    const rows = [];
    for (const [kind, status] of [
      ['PHOTO', 'READY'],
      ['PHOTO', 'PENDING'],
      ['VIDEO', 'READY'],
      ['VIDEO', 'FAILED'],
      ['PHOTO', 'DELETED'],
    ] as const) {
      const row = await prisma.gatheringMediaAsset.create({
        data: {
          groupId,
          folderId,
          uploaderUserId: member.user.id,
          kind,
          status,
          mimeType: kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4',
          sizeBytes: 32n,
          storageKey: `test/folders/${Math.random()}`,
          ...(status === 'DELETED' ? { deletedAt: new Date() } : {}),
        },
      });
      if (status !== 'DELETED') {
        storage.put(row.storageKey, jpeg(32));
        storage.put(`${row.storageKey}-pending`, jpeg(32));
        rows.push(row);
      }
    }
    const albums = (token: string) =>
      app.inject({
        method: 'GET',
        url: `/api/gathering/groups/${groupId}/albums`,
        headers: auth(token),
      });
    expect((await albums(owner.tokens.accessToken)).json().folders[0]).toMatchObject({
      photoCount: 2,
      videoCount: 1,
      canManage: true,
    });
    expect((await albums(secretary.tokens.accessToken)).json().folders[0].canManage).toBe(true);
    expect((await albums(member.tokens.accessToken)).json().folders[0].canManage).toBe(false);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/folders/${folderId}/media`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(detail.json().folder).toMatchObject({
      title: '바뀐 이름',
      photoCount: 2,
      videoCount: 1,
      canManage: true,
    });
    const links = [];
    for (let index = 0; index < 2; index += 1) {
      const link = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${groupId}/upload-links`,
        headers: auth(owner.tokens.accessToken),
        payload: { folderId },
      });
      links.push(link.json());
    }
    await prisma.gatheringUploadLink.update({
      where: { id: links[1].id },
      data: { pausedAt: new Date() },
    });
    const remove = vi.spyOn(storage, 'remove');
    expect((await manage(secretary.tokens.accessToken, 'DELETE')).statusCode).toBe(200);
    expect(remove).toHaveBeenCalledTimes(
      rows.length * 2 + rows.filter((row) => row.kind === 'VIDEO').length,
    );
    for (const row of rows) {
      expect(remove).toHaveBeenCalledWith(row.storageKey);
      expect(remove).toHaveBeenCalledWith(`${row.storageKey}-pending`);
      if (row.kind === 'VIDEO') expect(remove).toHaveBeenCalledWith(`${row.storageKey}.poster.jpg`);
      expect(await prisma.gatheringMediaAsset.findUnique({ where: { id: row.id } })).toMatchObject({
        status: 'DELETED',
        deletedAt: expect.any(Date),
      });
      expect(
        await prisma.gatheringAuditLog.count({
          where: { targetId: row.id, action: 'GATHERING_MEDIA_DELETE' },
        }),
      ).toBe(1);
    }
    expect(
      (await prisma.gatheringMediaFolder.findUniqueOrThrow({ where: { id: folderId } })).deletedAt,
    ).not.toBeNull();
    expect(
      await prisma.gatheringAuditLog.count({
        where: { targetId: folderId, action: 'GATHERING_MEDIA_FOLDER_DELETE' },
      }),
    ).toBe(1);
    for (const link of links) {
      expect(
        (await prisma.gatheringUploadLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt,
      ).not.toBeNull();
      expect(
        (await app.inject({ method: 'GET', url: `/api/gathering/public/uploads/${link.token}` }))
          .statusCode,
      ).toBe(404);
    }
    for (const method of ['POST', 'DELETE'] as const)
      expect((await manage(owner.tokens.accessToken, method)).statusCode).toBe(404);
    expect((await albums(owner.tokens.accessToken)).json().folders).toHaveLength(0);
    expect(
      (await prisma.gatheringEvent.findUniqueOrThrow({ where: { id: eventRes.json().id } }))
        .deletedAt,
    ).toBeNull();
    const empty = await createFolder(owner.tokens.accessToken);
    expect(empty.statusCode).toBe(200);
    expect((await manage(owner.tokens.accessToken, 'DELETE', empty.json().id)).statusCode).toBe(
      200,
    );
  });
  it('삭제 락을 기다린 폴더 예약을 거절하고 삭제 뒤 완료·재개 요청의 늦은 객체를 정리한다', async () => {
    const owner = await register('경합회장');
    const headers = auth(owner.tokens.accessToken);
    const group = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers,
      payload: { name: '폴더 경합' },
    });
    expect(group.statusCode).toBe(200);
    const groupId = group.json().id as string;
    groupIds.push(groupId);
    const folder = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders`,
      headers,
      payload: { title: '경합 폴더' },
    });
    const folderId = folder.json().id as string;
    const base = `/api/gathering/groups/${groupId}/folders/${folderId}`;
    const payload = { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] };
    const reserved = await app.inject({
      method: 'POST',
      url: `${base}/media/uploads`,
      headers,
      payload,
    });
    expect(reserved.statusCode).toBe(200);
    const assetId = reserved.json().items[0].id as string;
    const asset = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    storage.put(`${asset.storageKey}-pending`, jpeg(32));
    let entered!: () => void;
    let release!: () => void;
    const deleting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const unblock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRemove = storage.remove.bind(storage);
    const remove = vi.spyOn(storage, 'remove').mockImplementationOnce(async (key) => {
      entered();
      await unblock;
      await originalRemove(key);
    });
    const deletion = app.inject({ method: 'DELETE', url: base, headers }).then((result) => result);
    let reservation: Promise<unknown> | undefined;
    try {
      await deleting; // deleteMediaFolder already owns the real PostgreSQL group lock.
      let checked!: () => void;
      const prechecked = new Promise<void>((resolve) => {
        checked = resolve;
      });
      const originalFind = prisma.gatheringMediaFolder.findFirst.bind(prisma.gatheringMediaFolder);
      const find = vi
        .spyOn(prisma.gatheringMediaFolder, 'findFirst')
        .mockImplementationOnce(async (args) => {
          const row = await originalFind(args);
          checked();
          return row;
        });
      try {
        reservation = app
          .inject({ method: 'POST', url: `${base}/media/uploads`, headers, payload })
          .then((result) => result);
        await prechecked; // Reservation saw the folder before deletion committed.
      } finally {
        find.mockRestore();
        release();
      }
      expect((await deletion).statusCode).toBe(200);
      const rejected = (await reservation) as Awaited<ReturnType<typeof app.inject>>;
      expect(rejected.statusCode).toBe(404);
      expect(rejected.json().error.code).toBe('FOLDER_NOT_FOUND');
      expect(await prisma.gatheringMediaAsset.count({ where: { folderId, deletedAt: null } })).toBe(
        0,
      );
      for (const operation of ['complete', 'resume']) {
        // A signed R2 PUT can finish after the deletion transaction.
        storage.put(asset.storageKey, jpeg(32));
        storage.put(`${asset.storageKey}-pending`, jpeg(32));
        const late = await app.inject({
          method: 'POST',
          url: `${base}/media/${assetId}/${operation}`,
          headers,
          payload: operation === 'complete' ? { sizeBytes: 32 } : {},
        });
        expect(late.statusCode).toBe(404);
        expect(late.json().error.code).toBe('FOLDER_NOT_FOUND');
        expect(storage.objects.has(asset.storageKey)).toBe(false);
        expect(storage.objects.has(`${asset.storageKey}-pending`)).toBe(false);
        expect(
          (await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: assetId } })).status,
        ).toBe('DELETED');
      }
      // Also clean up assets left in an already deleted folder by the former race.
      const orphan = await prisma.gatheringMediaAsset.create({
        data: {
          groupId,
          folderId,
          uploaderUserId: owner.user.id,
          kind: 'PHOTO',
          status: 'PENDING',
          mimeType: 'image/jpeg',
          sizeBytes: 32n,
          storageKey: `test/orphan/${assetId}`,
        },
      });
      storage.put(`${orphan.storageKey}-pending`, jpeg(32));
      const orphanComplete = await app.inject({
        method: 'POST',
        url: `${base}/media/${orphan.id}/complete`,
        headers,
        payload: { sizeBytes: 32 },
      });
      expect(orphanComplete.statusCode).toBe(404);
      expect(
        (await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: orphan.id } }))
          .deletedAt,
      ).not.toBeNull();
      expect(storage.objects.has(`${orphan.storageKey}-pending`)).toBe(false);
    } finally {
      release();
      await deletion;
      if (reservation) await reservation;
      remove.mockRestore();
    }
  });
});
