import { randomBytes } from 'node:crypto';
import type { GatheringMediaAsset, GatheringMediaKind } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  SIGNED_URL_TTL_SECONDS,
  STORAGE_QUOTA_BYTES,
  billableStorageBytes,
  buildGatheringFolderObjectKey,
  canDeleteStoredObject,
  evaluateUpload,
  isPendingUploadLive,
  matchesDeclaredType,
  validateMediaUpload,
  type MediaKind,
} from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember, type GroupAccess } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { lockGroup } from '../locks.js';
import { gatheringUploadLimiter } from '../rate-limit.js';
import { buildGatheringObjectKey, currentObjectStorage } from '../storage/r2.js';
import { isSubscriptionActive, loadBillableUsage } from '../storage/usage.js';
import { rejectMedia, rejectUploadDecision } from './errors.js';
import { presentMedia } from './present.js';

type UploadItem = {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  originalName?: string;
};

type ReservedUpload = {
  id: string;
  kind: GatheringMediaKind;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
};

export async function createMediaUploads(
  userId: string,
  groupId: string,
  eventId: string,
  items: UploadItem[],
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_UPLOAD');
  gatheringUploadLimiter.assert(`${userId}:media-upload`);
  await requireEvent(groupId, eventId);
  const prepared = items.map(prepareItem);
  const storage = currentObjectStorage();
  const reserved = await reserveUploads(userId, groupId, eventId, prepared, storage.prefixEnv);
  return signUploads(reserved, storage);
}

export async function createFolderMediaUploads(
  userId: string,
  groupId: string,
  folderId: string,
  items: UploadItem[],
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_UPLOAD');
  gatheringUploadLimiter.assert(`${userId}:folder-upload`);
  const folder = await prisma.gatheringMediaFolder.findFirst({
    where: { id: folderId, groupId, deletedAt: null },
  });
  if (!folder) throw new AppError(404, 'FOLDER_NOT_FOUND', '사진 폴더를 찾을 수 없습니다.');
  const prepared = items.map(prepareItem);
  const storage = currentObjectStorage();
  const reserved = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const now = new Date();
    const usage = await loadBillableUsage(tx, groupId, now);
    const subscriptionActive = await isSubscriptionActive(tx, groupId, now);
    const additionalBytes = prepared.reduce((sum, item) => sum + item.sizeBytes, 0);
    const decision = evaluateUpload({ usage, subscriptionActive, kind: 'MEDIA', additionalBytes });
    if (!decision.allowed) rejectUploadDecision(decision);
    const rows: ReservedUpload[] = [];
    for (const item of prepared) {
      rows.push(await insertPending(tx, userId, groupId, { eventId: null, folderId }, storage.prefixEnv, item));
    }
    return rows;
  });
  return signUploads(reserved, storage);
}

export async function completeFolderMediaUpload(
  userId: string,
  groupId: string,
  folderId: string,
  assetId: string,
  sizeBytes: number,
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_UPLOAD');
  const asset = await requireOwnedPendingOrReady(userId, groupId, assetId, { folderId });
  if (asset.status === 'READY') return revalidateReady(asset, userId);
  await assertPendingStillValid(asset.storageKey, asset.createdAt, asset.sizeBytes, sizeBytes);
  if (await recoverPromotedObject(asset, sizeBytes)) {
    return { media: presentMedia(await markReady(asset.id), userId) };
  }
  await confirmStoredObject(pendingObjectKey(asset.storageKey), asset.mimeType, sizeBytes);
  await promotePendingObject(asset.storageKey, sizeBytes);
  const ready = await markReady(asset.id);
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.MEDIA_UPLOAD,
    targetType: 'GatheringMediaAsset',
    targetId: asset.id,
    meta: { bytes: sizeBytes, folderId },
  });
  return { media: presentMedia(ready, userId) };
}

export async function completeMediaUpload(
  userId: string,
  groupId: string,
  eventId: string,
  assetId: string,
  sizeBytes: number,
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_UPLOAD');
  const asset = await requireOwnedPendingOrReady(userId, groupId, assetId, { eventId });
  if (asset.status === 'READY') return revalidateReady(asset, userId);
  await assertPendingStillValid(asset.storageKey, asset.createdAt, asset.sizeBytes, sizeBytes);
  if (await recoverPromotedObject(asset, sizeBytes)) {
    return { media: presentMedia(await markReady(asset.id), userId) };
  }
  await confirmStoredObject(pendingObjectKey(asset.storageKey), asset.mimeType, sizeBytes);
  await promotePendingObject(asset.storageKey, sizeBytes);
  const ready = await markReady(asset.id);
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.MEDIA_UPLOAD,
    targetType: 'GatheringMediaAsset',
    targetId: asset.id,
    meta: { bytes: sizeBytes },
  });
  return { media: presentMedia(ready, userId) };
}

export async function resumeMediaUpload(userId: string, groupId: string, eventId: string, assetId: string) {
  await requireGroupMember(userId, groupId);
  const asset = await requireOwnedPendingOrReady(userId, groupId, assetId, { eventId });
  if (asset.status === 'READY') {
    const checked = await revalidateReady(asset, userId);
    return { status: 'READY' as const, media: checked.media };
  }
  if (!isPendingUploadLive(asset.createdAt, new Date())) {
    await discardPending(asset.storageKey);
    throw new AppError(409, 'UPLOAD_EXPIRED', '업로드 확인 시간이 지났습니다. 다시 시도하세요.');
  }
  const storage = currentObjectStorage();
  const target = await storage.presignPut({
    key: pendingObjectKey(asset.storageKey),
    contentType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
  return {
    status: 'PENDING' as const,
    id: asset.id,
    uploadUrl: target.url,
    expiresAt: target.expiresAt,
    headers: target.headers,
  };
}

export async function deleteMedia(userId: string, groupId: string, assetId: string) {
  const access = await requireGroupMember(userId, groupId);
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { id: assetId, groupId, deletedAt: null, status: { in: ['PENDING', 'READY', 'FAILED'] } },
  });
  if (!asset) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  assertCanDelete(access, asset.uploaderUserId);
  const storage = currentObjectStorage();
  await storage.remove(asset.storageKey);
  await storage.remove(pendingObjectKey(asset.storageKey));
  await markDeleted(asset.id, groupId, access.userId);
  return { ok: true as const };
}

function prepareItem(item: UploadItem) {
  const decision = validateMediaUpload(item);
  if (!decision.ok) rejectMedia(decision.code);
  return { ...item, folder: decision.folder };
}

async function reserveUploads(
  userId: string,
  groupId: string,
  eventId: string,
  items: Array<UploadItem & { folder: 'photos' | 'videos' }>,
  prefixEnv: string,
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const usage = await loadBillableUsage(tx, groupId, now);
    const subscriptionActive = await isSubscriptionActive(tx, groupId, now);
    const additionalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const decision = evaluateUpload({ usage, subscriptionActive, kind: 'MEDIA', additionalBytes });
    if (!decision.allowed) rejectUploadDecision(decision);
    const reserved: ReservedUpload[] = [];
    for (const item of items) {
      reserved.push(await insertPending(tx, userId, groupId, { eventId, folderId: null }, prefixEnv, item));
    }
    return reserved;
  });
}

async function insertPending(
  tx: Prisma.TransactionClient,
  userId: string,
  groupId: string,
  target: { eventId: string | null; folderId: string | null },
  prefixEnv: string,
  item: UploadItem & { folder: 'photos' | 'videos' },
) {
  const objectId = randomBytes(16).toString('hex');
  const storageKey = target.folderId
    ? buildGatheringFolderObjectKey({
        prefixEnv,
        groupId,
        folderId: target.folderId,
        folder: item.folder,
        objectId,
      })
    : buildGatheringObjectKey({
        prefixEnv,
        groupId,
        eventId: target.eventId ?? '',
        folder: item.folder,
        objectId,
      });
  const created = await tx.gatheringMediaAsset.create({
    data: {
      groupId,
      eventId: target.eventId,
      folderId: target.folderId,
      uploaderUserId: userId,
      kind: item.kind,
      storageKey,
      originalName: item.originalName ?? null,
      mimeType: item.mimeType,
      sizeBytes: BigInt(item.sizeBytes),
      width: item.width ?? null,
      height: item.height ?? null,
      durationMs: item.durationMs ?? null,
      status: 'PENDING',
    },
  });
  return {
    id: created.id,
    kind: created.kind,
    mimeType: created.mimeType,
    storageKey,
    sizeBytes: item.sizeBytes,
  };
}

async function signUploads(
  reserved: ReservedUpload[],
  storage: ReturnType<typeof currentObjectStorage>,
) {
  try {
    const items = [];
    for (const row of reserved) {
      const target = await storage.presignPut({
        key: pendingObjectKey(row.storageKey),
        contentType: row.mimeType,
        sizeBytes: row.sizeBytes,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      });
      items.push({
        id: row.id,
        kind: row.kind,
        uploadUrl: target.url,
        expiresAt: target.expiresAt,
        headers: target.headers,
      });
    }
    return { items };
  } catch (error) {
    await prisma.gatheringMediaAsset.updateMany({
      where: { id: { in: reserved.map((row) => row.id) }, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}

async function requireOwnedPendingOrReady(
  userId: string,
  groupId: string,
  assetId: string,
  scope: { eventId?: string; folderId?: string },
) {
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { id: assetId, groupId, deletedAt: null, ...scope },
  });
  if (!asset) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  if (asset.uploaderUserId !== userId) {
    throw new AppError(403, 'FORBIDDEN', '올린 사람만 업로드를 확정할 수 있습니다.');
  }
  if (asset.status === 'FAILED' || asset.status === 'DELETED') {
    throw new AppError(409, 'UPLOAD_FAILED', '이 업로드는 이미 실패했습니다. 다시 시도하세요.');
  }
  return asset;
}

async function assertPendingStillValid(storageKey: string, createdAt: Date, reserved: bigint, sizeBytes: number) {
  if (!isPendingUploadLive(createdAt, new Date())) {
    await discardPending(storageKey);
    throw new AppError(409, 'UPLOAD_EXPIRED', '업로드 확인 시간이 지났습니다. 다시 시도하세요.');
  }
  if (Number(reserved) !== sizeBytes) {
    throw new AppError(409, 'SIZE_MISMATCH', '올린 파일 크기가 예약한 크기와 다릅니다.');
  }
}

function pendingObjectKey(finalKey: string) {
  return `${finalKey}-pending`;
}

async function revalidateReady(asset: GatheringMediaAsset, userId: string) {
  const head = await currentObjectStorage().head(asset.storageKey);
  if (!head || head.sizeBytes !== Number(asset.sizeBytes)) {
    throw new AppError(409, 'SIZE_MISMATCH', '저장된 파일이 확인된 크기와 다릅니다.');
  }
  return { media: presentMedia(asset, userId) };
}

async function recoverPromotedObject(asset: GatheringMediaAsset, sizeBytes: number) {
  const storage = currentObjectStorage();
  const pending = await storage.head(pendingObjectKey(asset.storageKey));
  if (pending) return false;
  const finalObject = await storage.head(asset.storageKey);
  if (!finalObject) return false;
  if (finalObject.sizeBytes !== sizeBytes) {
    throw new AppError(409, 'SIZE_MISMATCH', '저장된 파일이 확인된 크기와 다릅니다.');
  }
  return true;
}

async function confirmStoredObject(storageKey: string, mimeType: string, sizeBytes: number) {
  const storage = currentObjectStorage();
  const head = await storage.head(storageKey);
  if (!head) throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
  if (head.sizeBytes !== sizeBytes) {
    await discardPending(finalKeyFromPending(storageKey));
    throw new AppError(409, 'SIZE_MISMATCH', '저장소의 파일 크기가 일치하지 않습니다.');
  }
  const header = await storage.readPrefix(storageKey, 16);
  if (!matchesDeclaredType(mimeType, header)) {
    await discardPending(finalKeyFromPending(storageKey));
    throw new AppError(415, 'UNSUPPORTED_TYPE', '파일 내용이 선언한 형식과 다릅니다.');
  }
}

async function promotePendingObject(finalKey: string, sizeBytes: number) {
  const storage = currentObjectStorage();
  await storage.relocate(pendingObjectKey(finalKey), finalKey);
  const head = await storage.head(finalKey);
  if (!head || head.sizeBytes !== sizeBytes) {
    await storage.remove(finalKey);
    await discardPending(finalKey);
    throw new AppError(409, 'SIZE_MISMATCH', '확정된 파일 크기가 일치하지 않습니다.');
  }
}

function finalKeyFromPending(pendingKey: string) {
  return pendingKey.endsWith('-pending') ? pendingKey.slice(0, -'-pending'.length) : pendingKey;
}

async function markReady(assetId: string) {
  return prisma.gatheringMediaAsset.update({
    where: { id: assetId },
    data: { status: 'READY' },
  });
}

async function discardPending(finalKey: string) {
  await currentObjectStorage().remove(pendingObjectKey(finalKey));
  await prisma.gatheringMediaAsset.updateMany({
    where: { storageKey: finalKey, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
}

function assertCanDelete(access: GroupAccess, uploaderUserId: string) {
  const actor = deleteActor(access, uploaderUserId);
  if (!canDeleteStoredObject({ kind: 'MEDIA', financeYearClosed: false, actor })) {
    throw new AppError(403, 'FORBIDDEN', '이 사진·영상을 삭제할 권한이 없습니다.');
  }
}

function deleteActor(access: GroupAccess, uploaderUserId: string) {
  if (access.userId === uploaderUserId) return 'UPLOADER' as const;
  if (access.permissions.includes('MEDIA_MODERATE')) return 'MODERATOR' as const;
  return 'OTHER' as const;
}

async function markDeleted(assetId: string, groupId: string, actorUserId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.gatheringMediaAsset.updateMany({
      where: { id: assetId, deletedAt: null },
      data: { status: 'DELETED', deletedAt: now },
    });
    if (updated.count !== 1) throw new AppError(409, 'MEDIA_GONE', '이미 삭제된 파일입니다.');
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId,
      action: GatheringAuditAction.MEDIA_DELETE,
      targetType: 'GatheringMediaAsset',
      targetId: assetId,
    });
  });
}

async function requireEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    select: { id: true },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
}

export async function storageSummary(userId: string, groupId: string) {
  await requireGroupMember(userId, groupId);
  const now = new Date();
  const usage = await loadBillableUsage(prisma, groupId, now);
  const subscriptionActive = await isSubscriptionActive(prisma, groupId, now);
  return {
    ...usage,
    usedBytes: billableStorageBytes(usage),
    quotaBytes: STORAGE_QUOTA_BYTES,
    subscriptionActive,
  };
}
