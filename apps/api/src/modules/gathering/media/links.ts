import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { MEDIA_PAGE_LIMIT } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { lockGroup } from '../locks.js';
import { gatheringPublicGalleryLimiter } from '../rate-limit.js';
import { cursorFilter, decodeMediaCursor, encodeMediaCursor } from './present.js';
import { signMediaDownload } from './queries.js';
import { canManageFolders } from './folder-access.js';
import { requireGroupMember } from '../access.js';
import {
  removeMediaAssets,
  completeFolderMediaUpload,
  completeMediaUpload,
  createFolderMediaUploads,
  createMediaUploads,
} from './commands.js';

const linkNotFound = () => new AppError(404, 'LINK_NOT_FOUND', '업로드 링크를 찾을 수 없습니다.');

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type UploadItem = {
  kind: 'PHOTO' | 'VIDEO';
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  originalName?: string;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function assertLinkManager(userId: string, groupId: string) {
  const access = await requireGroupMember(userId, groupId);
  if (!canManageFolders(access)) {
    throw new AppError(403, 'FORBIDDEN', '회장이나 총무만 업로드 링크를 관리합니다.');
  }
  return access;
}

export async function createUploadLink(
  userId: string,
  groupId: string,
  target: { eventId?: string; folderId?: string },
) {
  await assertLinkManager(userId, groupId);
  if (!target.eventId === !target.folderId) {
    throw new AppError(400, 'LINK_TARGET', '행사 또는 폴더 중 하나만 지정하세요.');
  }
  if (target.eventId) {
    const event = await prisma.gatheringEvent.findFirst({
      where: { id: target.eventId, groupId, deletedAt: null },
    });
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
  }
  if (target.folderId) {
    const folder = await prisma.gatheringMediaFolder.findFirst({
      where: { id: target.folderId, groupId, deletedAt: null },
    });
    if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  }
  const token = randomBytes(24).toString('hex');
  const created = await prisma.gatheringUploadLink.create({
    data: {
      groupId,
      eventId: target.eventId ?? null,
      folderId: target.folderId ?? null,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
      createdByUserId: userId,
    },
  });
  return {
    id: created.id,
    token,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export async function listUploadLinks(
  userId: string,
  groupId: string,
  filter: { eventId?: string; folderId?: string },
) {
  await assertLinkManager(userId, groupId);
  if (!filter.eventId === !filter.folderId) {
    throw new AppError(400, 'LINK_TARGET', '행사 또는 폴더 중 하나만 지정하세요.');
  }
  const now = new Date();
  // 아직 쓸 수 있는 링크는 개수와 상관없이 모두 돌려준다. 폐기·만료된 링크가 목록 자리를 차지하지 않는다.
  const rows = await prisma.gatheringUploadLink.findMany({
    where: {
      groupId,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(filter.folderId ? { folderId: filter.folderId } : { eventId: filter.eventId }),
    },
    orderBy: { createdAt: 'desc' },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      expiresAt: row.expiresAt.toISOString(),
      pausedAt: row.pausedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function setUploadLinkState(
  userId: string,
  groupId: string,
  linkId: string,
  action: 'revoke' | 'pause' | 'resume',
) {
  await assertLinkManager(userId, groupId);
  const link = await prisma.gatheringUploadLink.findFirst({ where: { id: linkId, groupId } });
  if (!link) throw new AppError(404, 'LINK_NOT_FOUND', '업로드 링크를 찾을 수 없습니다.');
  const data =
    action === 'revoke'
      ? { revokedAt: new Date(), pausedAt: null }
      : action === 'pause'
        ? { pausedAt: new Date() }
        : { pausedAt: null };
  await prisma.gatheringUploadLink.update({ where: { id: link.id }, data });
  return { ok: true as const };
}

export async function createMediaFolder(userId: string, groupId: string, title: string) {
  await assertLinkManager(userId, groupId);
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 80)
    throw new AppError(400, 'INVALID_TITLE', '폴더 이름을 확인하세요.');
  const created = await prisma.gatheringMediaFolder.create({
    data: { groupId, title: trimmed, createdByUserId: userId },
  });
  return { id: created.id, title: created.title };
}

export async function renameMediaFolder(
  userId: string,
  groupId: string,
  folderId: string,
  title: string,
) {
  await assertLinkManager(userId, groupId);
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 80)
    throw new AppError(400, 'INVALID_TITLE', '폴더 이름을 확인하세요.');
  const updated = await prisma.gatheringMediaFolder.updateMany({
    where: { id: folderId, groupId, deletedAt: null },
    data: { title: trimmed },
  });
  if (updated.count !== 1)
    throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  return { id: folderId, title: trimmed };
}

export async function deleteMediaFolder(userId: string, groupId: string, folderId: string) {
  const access = await assertLinkManager(userId, groupId);
  await prisma.$transaction(
    async (tx) => {
      await lockGroup(tx, groupId);
      const folder = await tx.gatheringMediaFolder.findFirst({
        where: { id: folderId, groupId, deletedAt: null },
      });
      if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
      const assets = await tx.gatheringMediaAsset.findMany({
        where: { groupId, folderId, eventId: null, deletedAt: null },
      });
      await removeMediaAssets(assets, groupId, access.userId, tx);
      const now = new Date();
      await tx.gatheringUploadLink.updateMany({
        where: { groupId, folderId, revokedAt: null },
        data: { revokedAt: now, pausedAt: null },
      });
      await tx.gatheringMediaFolder.update({ where: { id: folderId }, data: { deletedAt: now } });
      await writeGatheringAudit(tx, {
        groupId,
        actorUserId: access.userId,
        action: GatheringAuditAction.MEDIA_FOLDER_DELETE,
        targetType: 'GatheringMediaFolder',
        targetId: folderId,
      });
    },
    { timeout: 120_000 },
  );
  return { ok: true as const };
}

async function loadUsableLink(token: string) {
  if (!token) throw linkNotFound();
  const link = await prisma.gatheringUploadLink.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!link || link.revokedAt) throw linkNotFound();
  if (link.pausedAt) throw new AppError(409, 'LINK_PAUSED', '업로드 링크가 잠시 멈춰 있습니다.');
  if (link.expiresAt.getTime() <= Date.now())
    throw new AppError(410, 'LINK_EXPIRED', '업로드 링크가 만료되었습니다.');
  return link;
}

export async function publicUploadInfo(token: string) {
  const link = await loadUsableLink(token);
  const target = link.eventId
    ? await prisma.gatheringEvent.findUnique({
        where: { id: link.eventId },
        select: { title: true },
      })
    : await prisma.gatheringMediaFolder.findUnique({
        where: { id: link.folderId ?? '' },
        select: { title: true },
      });
  return {
    title: target?.title ?? '사진 업로드',
    kind: link.eventId ? ('event' as const) : ('folder' as const),
    expiresAt: link.expiresAt.toISOString(),
    notice: `이 링크는 사진과 영상을 올리고 이 ${link.eventId ? '일정' : '폴더'}의 사진을 볼 수 있습니다. 회원 명부와 재무는 볼 수 없습니다.`,
  };
}

async function publicGalleryScope(token: string): Promise<Prisma.GatheringMediaAssetWhereInput> {
  const link = await loadUsableLink(token);
  if (!link.eventId === !link.folderId) throw linkNotFound();
  gatheringPublicGalleryLimiter.assert(link.id);
  const parent = { groupId: link.groupId, deletedAt: null };
  return {
    ...parent,
    status: 'READY',
    eventId: link.eventId,
    folderId: link.folderId,
    ...(link.eventId ? { event: parent } : { folder: parent }),
  };
}

export async function listPublicMedia(token: string, cursor?: string) {
  const scope = await publicGalleryScope(token);
  const decoded = cursor ? decodeMediaCursor(cursor) : null;
  if (cursor && !decoded)
    throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
  const rows = await prisma.gatheringMediaAsset.findMany({
    where: { ...scope, ...cursorFilter(decoded) },
    select: { id: true, kind: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MEDIA_PAGE_LIMIT + 1,
  });
  const page = rows.slice(0, MEDIA_PAGE_LIMIT);
  const last = page[page.length - 1];
  return {
    items: page.map(({ id, kind, createdAt }) => ({
      id,
      kind,
      createdAt: createdAt.toISOString(),
      canDelete: false as const,
    })),
    nextCursor:
      rows.length > MEDIA_PAGE_LIMIT && last ? encodeMediaCursor(last.createdAt, last.id) : null,
  };
}

export async function downloadPublicMedia(token: string, assetId: string) {
  const scope = await publicGalleryScope(token);
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { ...scope, id: assetId },
    select: { storageKey: true, posterStorageKey: true, mimeType: true, kind: true },
  });
  if (!asset) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  return signMediaDownload(asset);
}

export async function publicReserve(token: string, items: UploadItem[]) {
  const link = await loadUsableLink(token);
  const limitKey = `public-upload:${link.id}`;
  if (link.eventId) {
    return createMediaUploads(link.createdByUserId, link.groupId, link.eventId, items, {
      limitKey,
    });
  }
  if (!link.folderId) throw new AppError(404, 'LINK_NOT_FOUND', '업로드 링크를 찾을 수 없습니다.');
  return createFolderMediaUploads(link.createdByUserId, link.groupId, link.folderId, items, {
    limitKey,
  });
}

export async function publicComplete(token: string, assetId: string, sizeBytes: number) {
  const link = await loadUsableLink(token);
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { id: assetId, groupId: link.groupId, deletedAt: null },
  });
  if (!asset || asset.uploaderUserId !== link.createdByUserId) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  }
  if (link.eventId && asset.eventId !== link.eventId) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  }
  if (link.folderId && asset.folderId !== link.folderId) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  }
  const { media } = link.eventId
    ? await completeMediaUpload(
        link.createdByUserId,
        link.groupId,
        link.eventId,
        assetId,
        sizeBytes,
      )
    : await completeFolderMediaUpload(
        link.createdByUserId,
        link.groupId,
        link.folderId ?? '',
        assetId,
        sizeBytes,
      );
  return {
    media: {
      id: media.id,
      kind: media.kind,
      hasPoster: media.hasPoster,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      createdAt: media.createdAt,
      canDelete: false as const,
    },
  };
}
