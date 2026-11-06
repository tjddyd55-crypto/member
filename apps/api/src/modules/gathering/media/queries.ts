import { calendarYearKst, MEDIA_PAGE_LIMIT, SIGNED_URL_TTL_SECONDS } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import { assertNotBlocked, blockedUserIds } from '../moderation/blocks.js';
import { currentObjectStorage } from '../storage/r2.js';
import { decodeMediaCursor, encodeMediaCursor, presentMedia } from './present.js';

export async function listEventMedia(
  userId: string,
  groupId: string,
  eventId: string,
  cursor: string | undefined,
  limit = MEDIA_PAGE_LIMIT,
) {
  await requireGroupMember(userId, groupId, 'read');
  await requireListedEvent(groupId, eventId);
  const hidden = await blockedUserIds(groupId, userId);
  const decoded = cursor ? decodeMediaCursor(cursor) : null;
  if (cursor && !decoded) throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
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
    items: page.map((row) => presentMedia(row, userId)),
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
  await requireGroupMember(userId, groupId, 'read');
  const folder = await prisma.gatheringMediaFolder.findFirst({
    where: { id: folderId, groupId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  const hidden = await blockedUserIds(groupId, userId);
  const decoded = cursor ? decodeMediaCursor(cursor) : null;
  if (cursor && !decoded) throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
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
    folder,
    items: page.map((row) => presentMedia(row, userId)),
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
  const target = await currentObjectStorage().presignGet({
    key: asset.storageKey,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
  return {
    url: target.url,
    expiresAt: target.expiresAt,
    mimeType: asset.mimeType,
    kind: asset.kind,
  };
}

export async function listAlbums(userId: string, groupId: string, year?: number) {
  await requireGroupMember(userId, groupId, 'read');
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
    select: { id: true, title: true, startsAt: true },
  });
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const cards = counts.flatMap((row) => {
    if (!row.eventId) return [];
    const event = byEvent.get(row.eventId);
    if (!event) return [];
    return [{ event, kind: row.kind, count: row._count._all }];
  });
  const eventList = eventCards(cards);
  for (const event of events) {
    if (eventList.some((card) => card.eventId === event.id)) continue;
    eventList.push({
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      year: calendarYearKst(event.startsAt),
      photoCount: 0,
      videoCount: 0,
    });
  }
  eventList.sort((left, right) => right.startsAt.localeCompare(left.startsAt));
  const folders = await prisma.gatheringMediaFolder.findMany({
    where: { groupId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const folderCounts = await prisma.gatheringMediaAsset.groupBy({
    by: ['folderId', 'kind'],
    where: {
      groupId,
      folderId: { not: null },
      status: 'READY',
      deletedAt: null,
      ...(hidden.size > 0 ? { uploaderUserId: { notIn: [...hidden] } } : {}),
    },
    _count: { _all: true },
  });
  return {
    years: yearTotals(cards),
    events: eventList.filter((card) => (year == null ? true : card.year === year)),
    folders: folders.map((folder) => ({
      folderId: folder.id,
      title: folder.title,
      photoCount: folderCounts.filter((row) => row.folderId === folder.id && row.kind === 'PHOTO').reduce((sum, row) => sum + row._count._all, 0),
      videoCount: folderCounts.filter((row) => row.folderId === folder.id && row.kind === 'VIDEO').reduce((sum, row) => sum + row._count._all, 0),
    })),
  };
}

function cursorFilter(decoded: { createdAt: Date; id: string } | null) {
  if (!decoded) return {};
  return {
    OR: [
      { createdAt: { lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { lt: decoded.id } },
    ],
  };
}

async function requireListedEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    select: { id: true },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
}

function yearTotals(
  cards: Array<{ event: { startsAt: Date }; kind: 'PHOTO' | 'VIDEO'; count: number }>,
) {
  const totals = new Map<number, { year: number; photoCount: number; videoCount: number }>();
  for (const card of cards) {
    const year = calendarYearKst(card.event.startsAt);
    const current = totals.get(year) ?? { year, photoCount: 0, videoCount: 0 };
    if (card.kind === 'PHOTO') current.photoCount += card.count;
    else current.videoCount += card.count;
    totals.set(year, current);
  }
  return [...totals.values()].sort((left, right) => right.year - left.year);
}

function eventCards(
  cards: Array<{ event: { id: string; title: string; startsAt: Date }; kind: 'PHOTO' | 'VIDEO'; count: number }>,
) {
  const grouped = new Map<
    string,
    { eventId: string; title: string; startsAt: string; year: number; photoCount: number; videoCount: number }
  >();
  for (const card of cards) {
    const current = grouped.get(card.event.id) ?? {
      eventId: card.event.id,
      title: card.event.title,
      startsAt: card.event.startsAt.toISOString(),
      year: calendarYearKst(card.event.startsAt),
      photoCount: 0,
      videoCount: 0,
    };
    if (card.kind === 'PHOTO') current.photoCount += card.count;
    else current.videoCount += card.count;
    grouped.set(card.event.id, current);
  }
  return [...grouped.values()].sort((left, right) => right.startsAt.localeCompare(left.startsAt));
}
