import { randomBytes } from 'node:crypto';
import {
  SIGNED_URL_TTL_SECONDS,
  canDeleteStoredObject,
  evaluateUpload,
  fiscalYearOf,
  isPendingUploadLive,
  validateReceiptUpload,
} from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { assertStoredObject } from '../storage/confirm.js';
import { buildGatheringObjectKey, currentObjectStorage } from '../storage/r2.js';
import { isSubscriptionActive, loadBillableUsage } from '../storage/usage.js';
import { lockFinanceYear, lockGroup } from '../locks.js';
import { lockGroupOpenYear, lockOpenYearById } from './years.js';

type ReceiptItem = { mimeType: string; sizeBytes: number; originalName?: string };

export async function createReceiptUploads(userId: string, groupId: string, eventId: string, items: ReceiptItem[]) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'RECEIPT_WRITE');
  const event = await requireEvent(groupId, eventId);
  const prepared = items.map(prepareReceipt);
  const storage = currentObjectStorage();
  const reserved = await prisma.$transaction((tx) =>
    reserveReceipts(tx, access.userId, groupId, event, prepared, storage.prefixEnv),
  );
  return signReceipts(reserved, storage);
}

export async function completeReceiptUpload(
  userId: string,
  groupId: string,
  eventId: string,
  receiptId: string,
  sizeBytes: number,
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'RECEIPT_WRITE');
  const receipt = await requireOwnReceipt(userId, groupId, eventId, receiptId);
  if (receipt.status === 'READY') return presentReceipt(receipt);
  await assertPending(receipt.id, receipt.createdAt, receipt.sizeBytes, sizeBytes);
  await assertStoredObject({
    storageKey: receipt.storageKey,
    mimeType: receipt.mimeType,
    sizeBytes,
    fail: () => failReceipt(receipt.id),
  });
  const ready = await prisma.$transaction(async (tx) => {
    await lockOpenYearById(tx, groupId, receipt.financeYearId);
    return tx.gatheringReceiptAsset.update({
      where: { id: receipt.id },
      data: { status: 'READY' },
    });
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: access.userId,
    action: GatheringAuditAction.RECEIPT_UPLOAD,
    targetType: 'GatheringReceiptAsset',
    targetId: ready.id,
  });
  return presentReceipt(ready);
}

export async function listReceipts(userId: string, groupId: string, eventId: string) {
  await requireGroupMember(userId, groupId);
  await requireEvent(groupId, eventId);
  const rows = await prisma.gatheringReceiptAsset.findMany({
    where: { groupId, eventId, status: 'READY', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return { items: rows.map(presentReceipt) };
}

export async function downloadReceipt(userId: string, groupId: string, receiptId: string) {
  await requireGroupMember(userId, groupId);
  const receipt = await prisma.gatheringReceiptAsset.findFirst({
    where: { id: receiptId, groupId, status: 'READY', deletedAt: null },
  });
  if (!receipt) throw new AppError(404, 'RECEIPT_NOT_FOUND', '영수증을 찾을 수 없습니다.');
  const target = await currentObjectStorage().presignGet({
    key: receipt.storageKey,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
  return { url: target.url, expiresAt: target.expiresAt, mimeType: receipt.mimeType };
}

export async function deleteReceipt(userId: string, groupId: string, receiptId: string) {
  const access = await requireGroupMember(userId, groupId);
  const receipt = await prisma.gatheringReceiptAsset.findFirst({
    where: { id: receiptId, groupId, deletedAt: null, status: { in: ['PENDING', 'READY'] } },
    include: { financeYear: true },
  });
  if (!receipt) throw new AppError(404, 'RECEIPT_NOT_FOUND', '영수증을 찾을 수 없습니다.');
  const actor = access.permissions.includes('RECEIPT_WRITE') ? 'TREASURER' : 'OTHER';
  const storageKey = await prisma.$transaction(async (tx) => {
    await lockGroup(tx, groupId);
    const current = await tx.gatheringReceiptAsset.findFirst({
      where: { id: receiptId, groupId, deletedAt: null, status: { in: ['PENDING', 'READY'] } },
    });
    if (!current) throw new AppError(404, 'RECEIPT_NOT_FOUND', '영수증을 찾을 수 없습니다.');
    await lockFinanceYear(tx, current.financeYearId);
    const year = await tx.gatheringFinanceYear.findUniqueOrThrow({ where: { id: current.financeYearId } });
    const fresh = await tx.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: current.id } });
    if (
      !canDeleteStoredObject({
        kind: 'RECEIPT',
        financeYearClosed: year.status === 'CLOSED' || fresh.immutable,
        actor,
      })
    ) {
      throw new AppError(403, 'FORBIDDEN', '이 영수증을 삭제할 권한이 없습니다.');
    }
    await tx.gatheringReceiptAsset.update({
      where: { id: fresh.id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    await writeGatheringAudit(tx, {
      groupId,
      actorUserId: access.userId,
      action: GatheringAuditAction.RECEIPT_DELETE,
      targetType: 'GatheringReceiptAsset',
      targetId: fresh.id,
    });
    return fresh.storageKey;
  });
  await currentObjectStorage().remove(storageKey);
  return { ok: true as const };
}

function prepareReceipt(item: ReceiptItem) {
  const decision = validateReceiptUpload(item);
  if (!decision.ok) {
    const message = decision.code === 'FILE_TOO_LARGE' ? '영수증 크기 제한을 넘었습니다.' : '영수증은 이미지 또는 PDF만 올릴 수 있습니다.';
    throw new AppError(400, decision.code, message);
  }
  return item;
}

async function reserveReceipts(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  groupId: string,
  event: { id: string; startsAt: Date },
  items: ReceiptItem[],
  prefixEnv: string,
) {
  const year = await lockGroupOpenYear(tx, groupId, fiscalYearOf(event.startsAt));
  const usage = await loadBillableUsage(tx, groupId, new Date());
  const decision = evaluateUpload({
    usage,
    subscriptionActive: await isSubscriptionActive(tx, groupId, new Date()),
    kind: 'RECEIPT',
    additionalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
  });
  if (!decision.allowed) {
    throw new AppError(409, 'QUOTA_EXCEEDED', '모임 저장 공간 50GB를 초과해 올릴 수 없습니다.');
  }
  const reserved = [];
  for (const item of items) {
    const objectId = randomBytes(16).toString('hex');
    const storageKey = buildGatheringObjectKey({
      prefixEnv,
      groupId,
      eventId: event.id,
      folder: 'receipts',
      objectId,
    });
    const created = await tx.gatheringReceiptAsset.create({
      data: {
        groupId,
        eventId: event.id,
        financeYearId: year.id,
        storageKey,
        originalName: item.originalName ?? null,
        mimeType: item.mimeType,
        sizeBytes: BigInt(item.sizeBytes),
        status: 'PENDING',
        uploadedByUserId: userId,
      },
    });
    reserved.push({ id: created.id, mimeType: created.mimeType, storageKey, sizeBytes: item.sizeBytes });
  }
  return reserved;
}

async function signReceipts(
  reserved: Array<{ id: string; mimeType: string; storageKey: string; sizeBytes: number }>,
  storage: ReturnType<typeof currentObjectStorage>,
) {
  try {
    const items = [];
    for (const row of reserved) {
      const target = await storage.presignPut({
        key: row.storageKey,
        contentType: row.mimeType,
        sizeBytes: row.sizeBytes,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      });
      items.push({ id: row.id, uploadUrl: target.url, expiresAt: target.expiresAt, headers: target.headers });
    }
    return { items };
  } catch (error) {
    await prisma.gatheringReceiptAsset.updateMany({
      where: { id: { in: reserved.map((row) => row.id) }, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}

async function requireOwnReceipt(userId: string, groupId: string, eventId: string, receiptId: string) {
  const receipt = await prisma.gatheringReceiptAsset.findFirst({
    where: { id: receiptId, groupId, eventId, deletedAt: null },
    include: { event: { select: { startsAt: true } } },
  });
  if (!receipt) throw new AppError(404, 'RECEIPT_NOT_FOUND', '영수증을 찾을 수 없습니다.');
  if (receipt.uploadedByUserId !== userId) {
    throw new AppError(403, 'FORBIDDEN', '올린 사람만 영수증 업로드를 확정할 수 있습니다.');
  }
  if (receipt.status === 'FAILED' || receipt.status === 'DELETED') {
    throw new AppError(409, 'UPLOAD_FAILED', '이 업로드는 이미 실패했습니다. 다시 시도하세요.');
  }
  return receipt;
}

async function assertPending(id: string, createdAt: Date, reserved: bigint, sizeBytes: number) {
  if (!isPendingUploadLive(createdAt, new Date())) {
    await failReceipt(id);
    throw new AppError(409, 'UPLOAD_EXPIRED', '업로드 확인 시간이 지났습니다. 다시 시도하세요.');
  }
  if (Number(reserved) !== sizeBytes) {
    throw new AppError(409, 'SIZE_MISMATCH', '올린 파일 크기가 예약한 크기와 다릅니다.');
  }
}

async function failReceipt(id: string) {
  await prisma.gatheringReceiptAsset.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
}

async function requireEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    select: { id: true, startsAt: true },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
  return event;
}

function presentReceipt(row: {
  id: string;
  mimeType: string;
  sizeBytes: bigint;
  originalName: string | null;
  immutable: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    originalName: row.originalName,
    immutable: row.immutable,
    createdAt: row.createdAt.toISOString(),
  };
}
