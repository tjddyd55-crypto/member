import {
  calendarYearKst,
  kstDateKey,
  MEDIA_PAGE_LIMIT,
  SIGNED_URL_TTL_SECONDS,
} from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import { assertNotBlocked, blockedUserIds } from '../moderation/blocks.js';
import { currentObjectStorage } from '../storage/r2.js';
import { canManageFolders } from './folder-access.js';
import { cursorFilter, decodeMediaCursor, encodeMediaCursor, presentMedia } from './present.js';

export async function listEventMedia(
  userId: string,
  groupId: string,
  eventId: string,
  cursor: string | undefined,
  limit = MEDIA_PAGE_LIMIT,
) {
  const access = await requireGroupMember(userId, groupId, 'read');
  await requireListedEvent(groupId, eventId);
  const hidden = await blockedUserIds(groupId, userId);
  const decoded = cursor ? decodeMediaCursor(cursor) : null;
  if (cursor && !decoded)
    throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
  const rows = await prisma.gatheringMediaAsset.findMany({
    where: {
      groupId,
      eventId,
      status: 'READY',
      deletedAt: null,
      ...(hidden.size > 0 ? { uploaderUserId: { notIn: [...hidden] } } : {}),
      ...cursorFilter(decoded),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      ...presentMedia(row, userId),
      canDelete: row.uploaderUserId === userId || access.permissions.includes('MEDIA_MODERATE'),
    })),
    nextCursor: rows.length > limit && last ? encodeMediaCursor(last.createdAt, last.id) : null,
  };
}

export async function listFolderMedia(
  userId: string,
  groupId: string,
  folderId: string,
  cursor: string | undefined,
  limit = MEDIA_PAGE_LIMIT,
) {
  const access = await requireGroupMember(userId, groupId, 'read');
  const folder = await prisma.gatheringMediaFolder.findFirst({
    where: { id: folderId, groupId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  const hidden = await blockedUserIds(groupId, userId);
  const decoded = cursor ? decodeMediaCursor(cursor) : null;
  if (cursor && !decoded)
    throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
  const rows = await prisma.gatheringMediaAsset.findMany({
    where: {
      groupId,
      folderId,
      status: 'READY',
      deletedAt: null,
      ...(hidden.size > 0 ? { uploaderUserId: { notIn: [...hidden] } } : {}),
      ...cursorFilter(decoded),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    folder: {
      ...folder,
      canManage: canManageFolders(access),
      photoCount: await prisma.gatheringMediaAsset.count({
        where: {
          groupId,
          folderId,
          deletedAt: null,
          status: { in: ['READY', 'PENDING'] },
          kind: 'PHOTO',
        },
      }),
      videoCount: await prisma.gatheringMediaAsset.count({
        where: {
          groupId,
          folderId,
          deletedAt: null,
          status: { in: ['READY', 'PENDING'] },
          kind: 'VIDEO',
        },
      }),
    },
    items: page.map((row) => ({
      ...presentMedia(row, userId),
      canDelete: row.uploaderUserId === userId || access.permissions.includes('MEDIA_MODERATE'),
    })),
    nextCursor: rows.length > limit && last ? encodeMediaCursor(last.createdAt, last.id) : null,
  };
}

export async function downloadMedia(userId: string, groupId: string, assetId: string) {
  await requireGroupMember(userId, groupId, 'read');
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { id: assetId, groupId, status: 'READY', deletedAt: null },
  });
  if (!asset) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  await assertNotBlocked(groupId, userId, asset.uploaderUserId);
  return signMediaDownload(asset);
}

export async function signMediaDownload(asset: {
  storageKey: string;
  posterStorageKey: string | null;
  mimeType: string;
  kind: 'PHOTO' | 'VIDEO';
}) {
  const storage = currentObjectStorage();
  const target = await storage.presignGet({
    key: asset.storageKey,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
  return {
    posterUrl: asset.posterStorageKey
      ? (
          await storage.presignGet({
            key: asset.posterStorageKey,
            expiresInSeconds: SIGNED_URL_TTL_SECONDS,
          })
        ).url
      : null,
    url: target.url,
    expiresAt: target.expiresAt,
    mimeType: asset.mimeType,
    kind: asset.kind,
  };
}

export async function listAlbums(userId: string, groupId: string, year?: number) {
  const access = await requireGroupMember(userId, groupId, 'read');
  const hidden = await blockedUserIds(groupId, userId);
  const counts = await prisma.gatheringMediaAsset.groupBy({
    by: ['eventId', 'kind'],
    where: {
      groupId,
      eventId: { not: null },
      status: 'READY',
      deletedAt: null,
      ...(hidden.size > 0 ? { uploaderUserId: { notIn: [...hidden] } } : {}),
    },
    _count: { _all: true },
  });
  const events = await prisma.gatheringEvent.findMany({
    where: { groupId, deletedAt: null },
    select: { id: true, title: true, startsAt: true, createdAt: true },
  });
  const countByEventAndKind = new Map(
    counts.map((row) => [`${row.eventId}:${row.kind}`, row._count._all]),
  );
  const eventList = events
    .map((event) => ({
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      year: calendarYearKst(event.startsAt),
      photoCount: countByEventAndKind.get(`${event.id}:PHOTO`) ?? 0,
      videoCount: countByEventAndKind.get(`${event.id}:VIDEO`) ?? 0,
    }))
    .sort((left, right) => right.startsAt.localeCompare(left.startsAt));
  const folders = await prisma.gatheringMediaFolder.findMany({
    where: { groupId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const folderCounts = await prisma.gatheringMediaAsset.groupBy({
    by: ['folderId', 'kind'],
    where: {
      groupId,
      folderId: { not: null },
      status: { in: ['READY', 'PENDING'] },
      deletedAt: null,
    },
    _count: { _all: true },
  });
  const countByFolderAndKind = new Map(
    folderCounts.map((row) => [`${row.folderId}:${row.kind}`, row._count._all]),
  );
  const canManage = canManageFolders(access);
  const folderList = folders.map((folder) => ({
    folderId: folder.id,
    createdAt: folder.createdAt.toISOString(),
    canManage,
    title: folder.title,
    photoCount: countByFolderAndKind.get(`${folder.id}:PHOTO`) ?? 0,
    videoCount: countByFolderAndKind.get(`${folder.id}:VIDEO`) ?? 0,
  }));
  const entries = [
    ...eventList.map((event) => ({
      item: { type: 'event' as const, ...event },
      date: new Date(event.startsAt),
      id: event.eventId,
    })),
    ...folderList.map((folder) => ({
      item: { type: 'folder' as const, ...folder },
      date: new Date(folder.createdAt),
      id: folder.folderId,
    })),
  ].map((entry) => ({
    ...entry,
    year: calendarYearKst(entry.date),
    day: kstDateKey(entry.date),
  }));
  const totals = new Map<number, { year: number; photoCount: number; videoCount: number }>();
  for (const entry of entries) {
    const total = totals.get(entry.year) ?? { year: entry.year, photoCount: 0, videoCount: 0 };
    total.photoCount += entry.item.photoCount;
    total.videoCount += entry.item.videoCount;
    totals.set(entry.year, total);
  }
  return {
    years: [...totals.values()].sort((left, right) => right.year - left.year),
    events: eventList.filter((event) => year == null || event.year === year),
    folders: folderList.filter(
      (folder) => year == null || calendarYearKst(new Date(folder.createdAt)) === year,
    ),
    items: entries
      .filter((entry) => year == null || entry.year === year)
      .sort(
        (left, right) =>
          right.day.localeCompare(left.day) ||
          right.item.createdAt.localeCompare(left.item.createdAt) ||
          right.id.localeCompare(left.id),
      )
      .map((entry) => entry.item),
  };
}

async function requireListedEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    select: { id: true },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
}
