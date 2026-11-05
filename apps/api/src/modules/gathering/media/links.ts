import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import {
  completeFolderMediaUpload,
  completeMediaUpload,
  createFolderMediaUploads,
  createMediaUploads,
} from './commands.js';

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
  if (!access.roles.includes('PRESIDENT') && !access.roles.includes('SECRETARY')) {
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
  const rows = await prisma.gatheringUploadLink.findMany({
    where: {
      groupId,
      ...(filter.folderId ? { folderId: filter.folderId } : { eventId: filter.eventId }),
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
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
  if (!trimmed || trimmed.length > 80) throw new AppError(400, 'INVALID_TITLE', '폴더 이름을 확인하세요.');
  const created = await prisma.gatheringMediaFolder.create({
    data: { groupId, title: trimmed, createdByUserId: userId },
  });
  return { id: created.id, title: created.title };
}

export async function renameMediaFolder(userId: string, groupId: string, folderId: string, title: string) {
  await assertLinkManager(userId, groupId);
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 80) throw new AppError(400, 'INVALID_TITLE', '폴더 이름을 확인하세요.');
  const updated = await prisma.gatheringMediaFolder.updateMany({
    where: { id: folderId, groupId, deletedAt: null },
    data: { title: trimmed },
  });
  if (updated.count !== 1) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  return { id: folderId, title: trimmed };
}

async function loadUsableLink(token: string) {
  const link = await prisma.gatheringUploadLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.revokedAt) throw new AppError(404, 'LINK_NOT_FOUND', '업로드 링크를 찾을 수 없습니다.');
  if (link.pausedAt) throw new AppError(409, 'LINK_PAUSED', '업로드 링크가 잠시 멈춰 있습니다.');
  if (link.expiresAt.getTime() <= Date.now()) throw new AppError(410, 'LINK_EXPIRED', '업로드 링크가 만료되었습니다.');
  return link;
}

export async function publicUploadInfo(token: string) {
  const link = await loadUsableLink(token);
  const target = link.eventId
    ? await prisma.gatheringEvent.findUnique({ where: { id: link.eventId }, select: { title: true } })
    : await prisma.gatheringMediaFolder.findUnique({ where: { id: link.folderId ?? '' }, select: { title: true } });
  return {
    title: target?.title ?? '사진 업로드',
    expiresAt: link.expiresAt.toISOString(),
    notice: '이 링크는 사진과 영상만 올립니다. 회원 명부, 재무, 이미 올린 파일은 볼 수 없습니다.',
  };
}

export async function publicReserve(token: string, items: UploadItem[]) {
  const link = await loadUsableLink(token);
  const limitKey = `public-upload:${link.id}`;
  if (link.eventId) {
    return createMediaUploads(link.createdByUserId, link.groupId, link.eventId, items, { limitKey });
  }
  if (!link.folderId) throw new AppError(404, 'LINK_NOT_FOUND', '업로드 링크를 찾을 수 없습니다.');
  return createFolderMediaUploads(link.createdByUserId, link.groupId, link.folderId, items, { limitKey });
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
  if (link.eventId) {
    return completeMediaUpload(link.createdByUserId, link.groupId, link.eventId, assetId, sizeBytes);
  }
  return completeFolderMediaUpload(link.createdByUserId, link.groupId, link.folderId ?? '', assetId, sizeBytes);
}
