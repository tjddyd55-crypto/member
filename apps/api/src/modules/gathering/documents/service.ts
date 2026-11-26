import { createHash, randomUUID } from 'node:crypto';
import type { GatheringDocument, Prisma } from '@prisma/client';
import { UPLOAD_INTENT_TTL_MS } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { assertGatheringWritable } from '../entitlement.js';
import { lockGroup } from '../locks.js';
import { gatheringUploadLimiter } from '../rate-limit.js';
import { currentObjectStorage } from '../storage/r2.js';
import { loadBillableUsage, loadGroupQuotaBytes } from '../storage/usage.js';
import { documentFormat, matchesDocument, unsupportedDocument } from './formats.js';

type Db = Prisma.TransactionClient;
type Actor = { groupId: string; userId: string };
type Location = { folderId: string | null; eventId: string | null };
const putSeconds = 15 * 60;
const pageSize = 40;
const uploader = { uploadedBy: { select: { gatheringProfile: { select: { displayName: true } } } } } as const;
const notFound = () => new AppError(404, 'DOCUMENT_NOT_FOUND', '파일 또는 폴더를 찾을 수 없습니다.');
const forbidden = () => new AppError(403, 'FORBIDDEN', '자료실 관리 권한이 없습니다.');
const pendingKey = (file: GatheringDocument) => file.storageKey + '-pending';

function canManage(roles: readonly string[]) {
  return roles.includes('PRESIDENT') || roles.includes('SECRETARY');
}

function fileLimit() {
  const configured = Number(process.env.GATHERING_DOCUMENT_MAX_BYTES ?? 100 * 1024 ** 2);
  return Number.isSafeInteger(configured) && configured > 0 && configured <= 100 * 1024 ** 2
    ? configured : 100 * 1024 ** 2;
}

function present(
  file: GatheringDocument & { uploadedBy?: { gatheringProfile: { displayName: string } | null } | null },
  actor: Actor,
  manager: boolean,
) {
  return {
    id: file.id, name: file.name, originalName: file.originalName, extension: file.extension,
    mimeType: file.mimeType, folderId: file.folderId, eventId: file.eventId,
    sizeBytes: Number(file.sizeBytes), createdAt: file.createdAt.toISOString(),
    uploadedBy: file.uploadedBy?.gatheringProfile?.displayName ?? '알 수 없는 회원',
    canDelete: manager || file.uploadedByUserId === actor.userId,
  };
}

async function getFolder(db: Db, groupId: string, id: string) {
  const folder = await db.gatheringDocumentFolder.findFirst({ where: { id, groupId } });
  if (!folder) throw notFound();
  return folder;
}

async function getFile(db: Db, groupId: string, id: string) {
  const file = await db.gatheringDocument.findFirst({
    where: { id, groupId, deletedAt: null }, include: uploader,
  });
  if (!file) throw notFound();
  return file;
}

async function checkLocation(db: Db, groupId: string, location: Location, activeEvent = false) {
  if (location.folderId) {
    const folder = await getFolder(db, groupId, location.folderId);
    if (folder.eventId !== location.eventId) throw notFound();
  }
  if (location.eventId && !await db.gatheringEvent.findFirst({
    where: { id: location.eventId, groupId, ...(activeEvent ? { deletedAt: null } : {}) },
    select: { id: true },
  })) throw notFound();
}

async function mutate<T>(actor: Actor, run: (tx: Db, manager: boolean) => Promise<T>, timeout = 10000) {
  await requireGroupMember(actor.userId, actor.groupId);
  return prisma.$transaction(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const access = await requireGroupMember(actor.userId, actor.groupId, 'write', tx);
    return run(tx, canManage(access.roles));
  }, { timeout, maxWait: 10000 });
}

function audit(tx: Db, actor: Actor, action: string, targetType: string, targetId: string, meta?: Record<string, string | null>) {
  return writeGatheringAudit(tx, {
    groupId: actor.groupId, actorUserId: actor.userId, action, targetType, targetId, meta,
  });
}

export async function listDocuments(actor: Actor, options: Location & {
  q?: string; sort: 'recent' | 'oldest' | 'name'; offset: number;
}) {
  const { groupId } = actor;
  const access = await requireGroupMember(actor.userId, groupId, 'read');
  const manager = canManage(access.roles);
  const { folderId, eventId, q, offset } = options;
  await checkLocation(prisma, groupId, { folderId, eventId });
  const filesWhere: Prisma.GatheringDocumentWhereInput = {
    groupId, status: 'READY', deletedAt: null,
    ...(!q || folderId || eventId ? { eventId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' } } : { folderId }),
    ...(q && folderId ? { folderId } : {}),
  };
  const [files, folders, folder] = await Promise.all([
    prisma.gatheringDocument.findMany({
      where: filesWhere,
      orderBy: options.sort === 'name' ? [{ name: 'asc' }, { id: 'asc' }] : [{ createdAt: options.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }],
      include: uploader, skip: offset, take: pageSize + 1,
    }),
    prisma.gatheringDocumentFolder.findMany({
      where: { groupId, eventId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : { parentId: folderId }) },
      orderBy: options.sort === 'name' ? [{ name: 'asc' }, { id: 'asc' }] : [{ createdAt: options.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }], skip: offset, take: pageSize + 1,
      select: {
        id: true, name: true, createdByUserId: true,
        _count: { select: { files: { where: { status: 'READY', deletedAt: null } } } },
      },
    }),
    folderId ? getFolder(prisma, groupId, folderId) : null,
  ]);
  const breadcrumbs: { id: string; name: string }[] = [];
  let ancestor = folder;
  while (ancestor && breadcrumbs.length < 32) {
    breadcrumbs.unshift({ id: ancestor.id, name: ancestor.name });
    ancestor = ancestor.parentId ? await getFolder(prisma, groupId, ancestor.parentId) : null;
  }
  return {
    breadcrumbs,
    files: files.slice(0, pageSize).map((file) => present(file, actor, manager)),
    folders: folders.slice(0, pageSize).map(({ id, name, _count, createdByUserId }) => ({ id, name, fileCount: _count.files, canManage: manager || createdByUserId === actor.userId })),
    folder: folder && { name: folder.name, parentId: folder.parentId },
    canManage: manager, canCreateFolder: true, maxBytes: fileLimit(),
    nextOffset: files.length > pageSize || folders.length > pageSize ? offset + pageSize : null,
  };
}

export async function listDocumentEvents(actor: Actor, offset: number) {
  await requireGroupMember(actor.userId, actor.groupId, 'read');
  const rows = await prisma.gatheringEvent.findMany({
    where: {
      groupId: actor.groupId,
      OR: [{ deletedAt: null }, { documents: { some: { status: 'READY', deletedAt: null } } }, { documentFolders: { some: {} } }],
    },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    skip: offset, take: pageSize + 1,
    select: { id: true, title: true, startsAt: true, deletedAt: true },
  });
  return {
    events: rows.slice(0, pageSize).map(({ id, title, startsAt, deletedAt }) => ({
      id, title, startsAt: startsAt.toISOString(), archived: !!deletedAt,
    })),
    nextOffset: rows.length > pageSize ? offset + pageSize : null,
  };
}

export function saveDocumentFolder(actor: Actor, id: string | null, data: { name?: string; parentId?: string | null; eventId?: string | null }) {
  return mutate(actor, async (tx, manager) => {
    const previous = id ? await getFolder(tx, actor.groupId, id) : null;
    if (previous && !manager && previous.createdByUserId !== actor.userId) throw forbidden();
    if (previous && !manager) {
      let level = [previous.id];
      while (level.length) {
        if (await tx.gatheringDocument.count({ where: { groupId: actor.groupId, folderId: { in: level }, deletedAt: null, OR: [{ uploadedByUserId: null }, { uploadedByUserId: { not: actor.userId } }] } })) throw forbidden();
        const children = await tx.gatheringDocumentFolder.findMany({ where: { groupId: actor.groupId, parentId: { in: level } }, select: { id: true, createdByUserId: true } });
        if (children.some((child) => child.createdByUserId !== actor.userId)) throw forbidden();
        level = children.map((child) => child.id);
      }
    }
    const eventId = data.eventId === undefined ? previous?.eventId ?? null : data.eventId;
    const parentId = data.parentId === undefined ? previous?.parentId ?? null : data.parentId;
    await checkLocation(tx, actor.groupId, { folderId: parentId, eventId }, true);
    if (previous && previous.eventId !== eventId) throw new AppError(409, 'FOLDER_SCOPE', '폴더는 같은 자료실 안에서 이동해 주세요.');
    let ancestorId = parentId;
    const ancestors = new Set<string>();
    while (ancestorId) {
      if (ancestorId === id || ancestors.has(ancestorId)) {
        throw new AppError(409, 'FOLDER_CYCLE', '폴더를 자신 또는 하위 폴더로 옮길 수 없습니다.');
      }
      if (ancestors.size >= 30) throw new AppError(409, 'FOLDER_DEPTH', '폴더 계층이 너무 깊습니다.');
      ancestors.add(ancestorId);
      ancestorId = (await getFolder(tx, actor.groupId, ancestorId)).parentId;
    }
    const name = data.name ?? previous!.name;
    const folder = previous
      ? await tx.gatheringDocumentFolder.update({ where: { id: previous.id }, data: { name, parentId } })
      : await tx.gatheringDocumentFolder.create({ data: { groupId: actor.groupId, name, parentId, eventId, createdByUserId: actor.userId } });
    await audit(tx, actor, previous ? 'DOCUMENT_FOLDER_UPDATE' : 'DOCUMENT_FOLDER_CREATE', 'documentFolder', folder.id,
      { parentId, previousParentId: previous?.parentId ?? null });
    return { id: folder.id };
  });
}

export function deleteDocumentFolder(actor: Actor, id: string) {
  return mutate(actor, async (tx, manager) => {
    const folder = await getFolder(tx, actor.groupId, id);
    if (!manager && folder.createdByUserId !== actor.userId) throw forbidden();
    if (await tx.gatheringDocumentFolder.count({ where: { parentId: id, groupId: actor.groupId } }) ||
        await tx.gatheringDocument.count({ where: { folderId: id, groupId: actor.groupId, deletedAt: null } })) {
      throw new AppError(409, 'FOLDER_NOT_EMPTY', '파일과 하위 폴더를 먼저 옮기거나 삭제해 주세요.');
    }
    await tx.gatheringDocument.updateMany({ where: { folderId: id, groupId: actor.groupId }, data: { folderId: null } });
    await tx.gatheringDocumentFolder.delete({ where: { id } });
    await audit(tx, actor, 'DOCUMENT_FOLDER_DELETE', 'documentFolder', id);
    return { ok: true };
  });
}

export async function reserveDocument(actor: Actor, input: Location & { name: string; mimeType?: string; sizeBytes: number }) {
  const format = documentFormat(input.name, input.mimeType);
  if (input.sizeBytes > fileLimit()) throw new AppError(413, 'DOCUMENT_SIZE', '파일당 업로드 한도를 초과했습니다.');
  const storage = currentObjectStorage();
  return mutate(actor, async (tx) => {
    gatheringUploadLimiter.assert(`${actor.userId}:documents`);
    const now = new Date();
    await assertGatheringWritable(tx, actor.groupId, now);
    await checkLocation(tx, actor.groupId, input, true);
    const usage = await loadBillableUsage(tx, actor.groupId, now);
    if (usage.mediaBytes + usage.receiptBytes + usage.otherBytes + input.sizeBytes > await loadGroupQuotaBytes(tx, actor.groupId, now)) {
      throw new AppError(409, 'STORAGE_QUOTA', '모임 저장 용량을 초과했습니다.');
    }
    const file = await tx.gatheringDocument.create({ data: {
      ...actorGroup(actor), eventId: input.eventId, folderId: input.folderId,
      name: input.name, originalName: input.name, ...format, sizeBytes: BigInt(input.sizeBytes),
      storageKey: `${storage.prefixEnv}/gatherings/${actor.groupId}/documents/${randomUUID()}`,
    } });
    const target = await storage.presignPut({ key: pendingKey(file), contentType: file.mimeType,
      sizeBytes: input.sizeBytes, expiresInSeconds: putSeconds });
    return { id: file.id, target };
  });
}

function actorGroup(actor: Actor) {
  return { groupId: actor.groupId, uploadedByUserId: actor.userId };
}

// Bound concurrent full-file validation per process. The group lock also serializes quota changes.
let validating = 0;
export async function completeDocument(actor: Actor, id: string) {
  if (validating >= 2) throw new AppError(503, 'DOCUMENT_BUSY', '파일 확인 중입니다. 잠시 후 다시 시도해 주세요.');
  validating++;
  try {
    const result = await mutate(actor, async (tx, manager) => {
      const file = await getFile(tx, actor.groupId, id);
      if (file.uploadedByUserId !== actor.userId) throw forbidden();
      if (file.status === 'READY') return { file: present(file, actor, manager) };
      const now = new Date();
      if (now.getTime() - file.createdAt.getTime() >= UPLOAD_INTENT_TTL_MS) {
        throw new AppError(409, 'DOCUMENT_EXPIRED', '업로드 시간이 만료되었습니다. 파일을 다시 선택해 주세요.');
      }
      await assertGatheringWritable(tx, actor.groupId, now);
      await checkLocation(tx, actor.groupId, file, true);
      const storage = currentObjectStorage();
      const bytes = Number(file.sizeBytes);
      // Validate the immutable copy. An unexpired signed PUT can only change the staging key.
      let head = await storage.head(file.storageKey);
      if (!head) {
        const pending = await storage.head(pendingKey(file));
        if (!pending) throw new AppError(409, 'OBJECT_MISSING', '전송된 파일을 찾을 수 없습니다.');
        if (pending.sizeBytes === bytes) {
          await storage.relocate(pendingKey(file), file.storageKey);
          head = await storage.head(file.storageKey);
        }
      }
      let error: AppError | undefined;
      let checksum: string | undefined;
      if (head?.sizeBytes !== bytes) {
        error = new AppError(409, 'SIZE_MISMATCH', '저장소의 파일 크기가 일치하지 않습니다.');
      } else {
        const raw = await storage.readPrefix(file.storageKey, bytes);
        const content = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
        try {
          if (content.length !== bytes || !await matchesDocument(file.extension, content)) {
            error = unsupportedDocument();
          }
        } catch (caught) {
          if (!(caught instanceof AppError)) throw caught;
          error = caught;
        }
        if (!error) checksum = createHash('sha256').update(content).digest('hex');
      }
      if (checksum) {
        const duplicate = await tx.gatheringDocument.findUnique({
          where: { groupId_checksum: { groupId: actor.groupId, checksum } }, include: uploader,
        });
        if (duplicate) {
          await markDeleted(tx, file.id, now);
          if (duplicate.folderId === file.folderId && duplicate.eventId === file.eventId) {
            return { file: present(duplicate, actor, manager) };
          }
          return { error: new AppError(409, 'DOCUMENT_DUPLICATE', '같은 파일이 이 모임의 다른 위치에 이미 있습니다.') };
        }
      }
      if (error) {
        await markDeleted(tx, file.id, now);
        return { error };
      }
      const saved = await tx.gatheringDocument.update({
        where: { id }, data: { status: 'READY', checksum }, include: uploader,
      });
      await audit(tx, actor, 'DOCUMENT_UPLOAD', 'document', id, { folderId: saved.folderId, eventId: saved.eventId });
      return { file: present(saved, actor, manager) };
    }, 120000);
    if ('error' in result) throw result.error;
    return result.file;
  } finally {
    validating--;
  }
}

function markDeleted(tx: Db, id: string, now: Date) {
  return tx.gatheringDocument.update({ where: { id }, data: {
    status: 'DELETED', deletedAt: now, cleanedAt: null, checksum: null,
  } });
}

export function updateDocument(actor: Actor, id: string, input: { name?: string; location?: Location }) {
  return mutate(actor, async (tx, manager) => {
    const file = await getFile(tx, actor.groupId, id);
    if (!manager && file.uploadedByUserId !== actor.userId) throw forbidden();
    if (file.status !== 'READY') throw notFound();
    if (input.location) await checkLocation(tx, actor.groupId, input.location, true);
    if (input.name && documentFormat(input.name).extension !== file.extension) {
      throw new AppError(400, 'DOCUMENT_EXTENSION', '파일의 확장자는 변경할 수 없습니다.');
    }
    const data = { ...input.location, name: input.name };
    await tx.gatheringDocument.update({ where: { id }, data });
    await audit(tx, actor, 'DOCUMENT_UPDATE', 'document', id, {
      previousFolderId: file.folderId, previousEventId: file.eventId,
      folderId: input.location ? input.location.folderId : file.folderId,
      eventId: input.location ? input.location.eventId : file.eventId,
    });
    return { ok: true };
  });
}

export function deleteDocument(actor: Actor, id: string) {
  return mutate(actor, async (tx, manager) => {
    const file = await getFile(tx, actor.groupId, id);
    if (!manager && file.uploadedByUserId !== actor.userId) throw forbidden();
    await markDeleted(tx, id, new Date());
    await audit(tx, actor, 'DOCUMENT_DELETE', 'document', id, { folderId: file.folderId, eventId: file.eventId });
    return { ok: true };
  });
}

export async function downloadDocument(actor: Actor, id: string) {
  await requireGroupMember(actor.userId, actor.groupId, 'read');
  const file = await getFile(prisma, actor.groupId, id);
  if (file.status !== 'READY') throw notFound();
  const target = await currentObjectStorage().presignGet({ key: file.storageKey, expiresInSeconds: 120 });
  return { url: target.url, expiresAt: target.expiresAt };
}

export async function cleanDocumentObjects(now = new Date()) {
  const expiredBefore = new Date(now.getTime() - UPLOAD_INTENT_TTL_MS);
  const files = await prisma.gatheringDocument.findMany({
    where: { cleanedAt: null, createdAt: { lt: expiredBefore } },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 50,
    select: { id: true, groupId: true },
  });
  if (!files.length) return;
  const storage = currentObjectStorage();
  for (const ref of files) {
    await prisma.$transaction(async (tx) => {
      await lockGroup(tx, ref.groupId);
      const file = await tx.gatheringDocument.findUnique({ where: { id: ref.id } });
      if (!file || file.cleanedAt) return;
      if (file.status !== 'READY') {
        await storage.remove(file.storageKey);
        if (!file.deletedAt) await markDeleted(tx, file.id, now);
      }
      await storage.remove(pendingKey(file));
      await tx.gatheringDocument.update({ where: { id: file.id }, data: { cleanedAt: now } });
    }, { timeout: 20000 }).catch(async () => {
      // Leave the job pending and put it behind other eligible objects.
      await prisma.gatheringDocument.updateMany({ where: { id: ref.id, cleanedAt: null }, data: { updatedAt: now } });
    });
  }
}
