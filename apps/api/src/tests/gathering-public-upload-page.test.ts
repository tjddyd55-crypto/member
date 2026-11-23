import { Script } from 'node:vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { uploadPage } from '../modules/gathering/media/public-upload-page.js';
import { gatheringPublicGalleryLimiter } from '../modules/gathering/rate-limit.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';

let app: FastifyInstance;
const prefix = '/api/gathering/public/uploads';
const link = {
  id: 'link-id',
  tokenHash: 'hash',
  groupId: 'target-group',
  eventId: 'target-event',
  folderId: null,
  createdByUserId: 'link-owner',
  createdAt: new Date(),
  expiresAt: new Date('2099-01-01'),
  revokedAt: null,
  pausedAt: null,
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  vi.restoreAllMocks();
  gatheringPublicGalleryLimiter.reset();
  useObjectStorage(new MemoryObjectStorage());
});

afterAll(async () => {
  vi.restoreAllMocks();
  useObjectStorage('default');
  await app.close();
});

describe('공개 업로드 갤러리', () => {
  it('escapes HTML and inlines a script that treats the token as data', () => {
    const payload = '</script><script>alert("x")</script>';
    const html = uploadPage({ title: payload, notice: payload, kind: 'folder' }, payload);
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('const token = "\\u003c/script>\\u003cscript>');
    const script = html.split('<script>')[1].split('</script>')[0];
    expect(() => new Script(script)).not.toThrow();
  });

  it('serves the page without a session and returns the same 404 for missing and revoked tokens', async () => {
    const findLink = vi.spyOn(prisma.gatheringUploadLink, 'findUnique');
    findLink.mockResolvedValueOnce(link);
    vi.spyOn(prisma.gatheringEvent, 'findUnique').mockResolvedValueOnce({
      title: '11월 이사회',
    } as never);
    const valid = await app.inject(prefix + '/token');
    expect(valid.statusCode).toBe(200);
    expect(valid.body).toContain('<h1>11월 이사회</h1>');
    expect(valid.body).toContain('viewport-fit=cover');

    findLink.mockResolvedValueOnce({ ...link, revokedAt: new Date() }).mockResolvedValue(null);
    const revoked = await app.inject(prefix + '/revoked');
    const missing = await app.inject(prefix + '/missing');
    const noToken = await app.inject(prefix);
    expect([revoked.statusCode, missing.statusCode, noToken.statusCode]).toEqual([404, 404, 404]);
    expect(revoked.headers['content-type']).toContain('text/html');
    expect(noToken.body).toBe(missing.body);
    expect((await app.inject(prefix + '/')).body).toBe(missing.body);
    expect(missing.body).toBe(revoked.body);
  });

  it('signs only the matched folder asset, and stops signing when its link is paused or expired', async () => {
    const folderLink = { ...link, eventId: null, folderId: 'target-folder' };
    const findLink = vi
      .spyOn(prisma.gatheringUploadLink, 'findUnique')
      .mockResolvedValue(folderLink);
    const asset = {
      storageKey: 'test/video.mp4',
      posterStorageKey: 'test/poster.jpg',
      mimeType: 'video/mp4',
      kind: 'VIDEO' as const,
    };
    const findAsset = vi.spyOn(prisma.gatheringMediaAsset, 'findFirst');
    findAsset.mockResolvedValueOnce(asset as never);
    const sign = vi.spyOn(MemoryObjectStorage.prototype, 'presignGet');
    const url = prefix + '/token/media/video';
    const download = await app.inject(url);
    expect(download.statusCode).toBe(200);
    expect(download.headers['cache-control']).toBe('no-store');
    expect(download.json()).toEqual({
      url: 'https://storage.test/get/test%2Fvideo.mp4',
      posterUrl: 'https://storage.test/get/test%2Fposter.jpg',
      expiresAt: expect.any(String),
      mimeType: 'video/mp4',
      kind: 'VIDEO',
    });
    expect(findAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'video',
          groupId: 'target-group',
          eventId: null,
          folderId: 'target-folder',
          status: 'READY',
          deletedAt: null,
          folder: { groupId: 'target-group', deletedAt: null },
        },
      }),
    );
    for (const key of [asset.storageKey, asset.posterStorageKey])
      expect(sign).toHaveBeenCalledWith({ key, expiresInSeconds: 600 });

    const states = [
      { data: { pausedAt: new Date() }, status: 409, code: 'LINK_PAUSED' },
      { data: { expiresAt: new Date(0) }, status: 410, code: 'LINK_EXPIRED' },
    ];
    for (const { data, status, code } of states) {
      findLink.mockResolvedValue({ ...folderLink, ...data });
      const page = await app.inject(prefix + '/token');
      expect(page.statusCode).toBe(status);
      expect(page.body).toContain('class="link-error"');
      for (const path of [prefix + '/token/media', url]) {
        const response = await app.inject(path);
        expect(response.statusCode).toBe(status);
        expect(response.json().error.code).toBe(code);
        expect(page.body).toContain(response.json().error.message);
      }
    }
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('scopes both media queries to the stored target and rate-limits by link', async () => {
    const findLink = vi.spyOn(prisma.gatheringUploadLink, 'findUnique').mockResolvedValue(link);
    const findMany = vi.spyOn(prisma.gatheringMediaAsset, 'findMany').mockResolvedValue([]);
    const findAsset = vi.spyOn(prisma.gatheringMediaAsset, 'findFirst').mockResolvedValue(null);
    const where = {
      groupId: link.groupId,
      eventId: link.eventId,
      folderId: null,
      status: 'READY',
      deletedAt: null,
      event: { groupId: link.groupId, deletedAt: null },
    };
    const media = prefix + '/token/media';
    const list = await app.inject(media + '?eventId=another-event&groupId=another-group');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [], nextCursor: null });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 31 }));
    expect((await app.inject(media + '/outside')).statusCode).toBe(404);
    expect(findAsset).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ...where, id: 'outside' } }),
    );

    for (let hit = 2; hit < 180; hit++) gatheringPublicGalleryLimiter.assert(link.id);
    expect((await app.inject(media)).statusCode).toBe(429);
    expect((await app.inject(media + '/outside')).statusCode).toBe(429);
    findLink.mockResolvedValueOnce({ ...link, id: 'another-link' });
    expect((await app.inject(prefix + '/another-token/media')).statusCode).toBe(200);
    expect(findAsset).toHaveBeenCalledTimes(1);
  });
});
