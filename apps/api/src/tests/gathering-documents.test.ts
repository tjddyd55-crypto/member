import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as cfb from 'cfb';
import { strToU8, zipSync } from 'fflate';
import { STORAGE_QUOTA_BYTES, UPLOAD_INTENT_TTL_MS } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { documentFormat, matchesDocument } from '../modules/gathering/documents/formats.js';
import { cleanDocumentObjects } from '../modules/gathering/documents/service.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';
import { R2ObjectStorage } from '../modules/gathering/storage/s3-sigv4.js';
import { loadBillableUsage } from '../modules/gathering/storage/usage.js';

const storage = new MemoryObjectStorage();
const users: string[] = [];
const groups: string[] = [];
let app: FastifyInstance;
type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH';

beforeAll(async () => {
  gatheringAuthLimiter.reset();
  useObjectStorage(storage);
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  useObjectStorage('default');
  const groupId = { in: groups };
  const userId = { in: users };
  await prisma.gatheringDocument.deleteMany({ where: { groupId } });
  await prisma.gatheringDocumentFolder.updateMany({ where: { groupId }, data: { parentId: null } });
  await prisma.gatheringDocumentFolder.deleteMany({ where: { groupId } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId } });
  await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId } });
  await prisma.gatheringAuditLog.deleteMany({ where: { groupId } });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId } });
  await prisma.gatheringEvent.deleteMany({ where: { groupId } });
  await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId } });
  await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId } });
  await prisma.gatheringInvite.deleteMany({ where: { groupId } });
  await prisma.gatheringMembership.deleteMany({ where: { groupId } });
  await prisma.gatheringFinanceYear.deleteMany({ where: { groupId } });
  await prisma.gatheringGroup.deleteMany({ where: { id: groupId } });
  await prisma.gatheringNotification.deleteMany({ where: { userId } });
  await prisma.gatheringSession.deleteMany({ where: { userId } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId } });
  await prisma.gatheringProfile.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await app.close();
  await prisma.$disconnect();
});

function call(token: string | null, method: HttpMethod, path: string, payload?: object) {
  return app.inject({
    method, url: '/api/gathering' + path,
    ...(token ? { headers: { authorization: 'Bearer ' + token } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function user(name: string) {
  const entry = await call(null, 'POST', '/auth/register', {
    name, phone: `010${Math.floor(10000000 + Math.random() * 89999999)}`,
    password: 'Passw0rd!', localJcName: '서울테스자료', directoryConsent: true, birthDate: '1990-02-01', sex: 'MALE',
  });
  expect(entry.statusCode, entry.body).toBe(200);
  users.push(entry.json().user.id);
  return { id: entry.json().user.id as string, token: entry.json().tokens.accessToken as string };
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const office = (entry: string) => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  [entry]: strToU8('<document/>'),
}));
const hwpx = Buffer.from(zipSync({
  mimetype: strToU8('application/hwp+zip'),
  'Contents/content.hpf': strToU8('<package/>'),
}));
function compound(stream: string, body = 'document') {
  const file = cfb.utils.cfb_new();
  cfb.utils.cfb_add(file, stream, Buffer.from(body));
  return Buffer.from(cfb.write(file, { type: 'buffer' }));
}

describe('document type validation', () => {
  it.each([
    ['pdf', pdf],
    ['hwp', compound('FileHeader', 'HWP Document File\0')],
    ['hwpx', hwpx],
    ['doc', compound('WordDocument')],
    ['xls', compound('Workbook')],
    ['ppt', compound('PowerPoint Document')],
    ['docx', office('word/document.xml')],
    ['xlsx', office('xl/workbook.xml')],
    ['pptx', office('ppt/presentation.xml')],
    ['txt', Buffer.from('회의 자료')],
    ['csv', Buffer.from('제목,날짜\n정기총회,2026-12-03')],
    ['zip', Buffer.from(zipSync({ '자료.txt': strToU8('자료') }))],
  ])('recognizes %s by content', async (extension, bytes) => {
    expect(await matchesDocument(extension, bytes)).toBe(true);
  });
  it('rejects wrong MIME, mismatched document families, binary text and unsupported extensions', async () => {
    expect(() => documentFormat('회의.hwp', 'application/pdf')).toThrow();
    expect(() => documentFormat('회의.exe')).toThrow();
    expect(await matchesDocument('pdf', hwpx)).toBe(false);
    expect(await matchesDocument('hwp', compound('WordDocument'))).toBe(false);
    expect(await matchesDocument('docx', office('xl/workbook.xml'))).toBe(false);
    expect(await matchesDocument('txt', Buffer.from([0, 1, 2, 3]))).toBe(false);
  });
});

it('bounds the R2 response body to the declared read length', async () => {
  const r2 = new R2ObjectStorage({
    bucket: 'test', endpoint: 'https://storage.test', accessKeyId: 'fake', secretAccessKey: 'fake',
    region: 'auto', prefixEnv: 'test',
  });
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    fetch.mockResolvedValueOnce(new Response('ABC', { status: 206 }));
    expect(Buffer.from(await r2.readPrefix('key', 3)).toString()).toBe('ABC');
    fetch.mockResolvedValueOnce(new Response('ABCD', { status: 206 }));
    await expect(r2.readPrefix('key', 3)).rejects.toThrow();
  } finally {
    fetch.mockRestore();
  }
});

it('shares one event record, gates writes and reads, and accounts for all storage', async () => {
  const chair = await user('자료회장');
  const member = await user('자료회원');
  const outsider = await user('다른모임');
  const created = await call(chair.token, 'POST', '/groups', { name: '자료실 검증 모임' });
  expect(created.statusCode, created.body).toBe(200);
  const groupId = created.json().id as string;
  groups.push(groupId);
  const other = await call(outsider.token, 'POST', '/groups', { name: '자료실 격리 모임' });
  expect(other.statusCode, other.body).toBe(200);
  groups.push(other.json().id);
  const base = `/groups/${groupId}`;
  const docs = base + '/documents';
  const invite = await call(chair.token, 'POST', base + '/invites', { requiresApproval: false });
  const join = await call(member.token, 'POST', `/invites/${invite.json().token}/accept`, { directoryConsent: true });
  expect(join.statusCode, join.body).toBe(200);
  const now = Date.now();
  const pass = await prisma.gatheringSubscription.create({
    data: { groupId, status: 'ACTIVE', source: 'COMPLIMENTARY', approvedByUserId: chair.id,
      startsAt: new Date(now - 3600000), expiresAt: new Date(now + 3600000) },
  });
  expect(Number(pass.storageQuotaBytes)).toBe(STORAGE_QUOTA_BYTES);

  const folder = async (name: string, parentId?: string) => {
    const response = await call(chair.token, 'POST', docs + '/folders', { name, parentId });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().id as string;
  };
  expect((await call(member.token, 'POST', docs + '/folders', { name: '금지' })).statusCode).toBe(403);
  const parent = await folder('회의록');
  const child = await folder('11월', parent);
  expect((await call(chair.token, 'PATCH', docs + '/folders/' + parent, { parentId: child })).json().error.code).toBe('FOLDER_CYCLE');
  expect((await call(chair.token, 'PATCH', docs + '/folders/' + child, { name: '12월', parentId: null })).statusCode).toBe(200);
  expect((await call(chair.token, 'DELETE', docs + '/folders/' + parent)).statusCode).toBe(200);
  const event = async (title: string) => {
    const response = await call(chair.token, 'POST', base + '/events', { title, startsAt: '2027-01-08T09:00:00Z' });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().id as string;
  };
  const first = await event('자료 행사');
  const second = await event('별도 행사');
  expect((await call(null, 'GET', docs)).statusCode).toBe(401);
  expect((await call(outsider.token, 'GET', docs)).statusCode).toBe(404);

  const staged = async (name: string, body: Buffer, location: { eventId?: string; folderId?: string; mimeType?: string }) => {
    const response = await call(member.token, 'POST', docs + '/uploads', { name, sizeBytes: body.length, ...location });
    expect(response.statusCode, response.body).toBe(200);
    const { id, target } = response.json();
    storage.put(decodeURIComponent(new URL(target.url).pathname.split('/').at(-1)!), body);
    return { id: id as string, complete: () => call(member.token, 'POST', `${docs}/files/${id}/complete`) };
  };
  const pdfUpload = await staged('회의록.pdf', pdf, { eventId: first });
  const hwp = compound('FileHeader', 'HWP Document File\0');
  const hwpUpload = await staged('회의록.hwp', hwp, { eventId: first });
  expect((await pdfUpload.complete()).statusCode).toBe(200);
  const hwpResult = await hwpUpload.complete();
  expect(hwpResult.statusCode, hwpResult.body).toBe(200);
  const [storedHwp] = [...storage.objects.entries()].filter(([, bytes]) => bytes.equals(hwp));
  expect(storedHwp?.[1]).toEqual(hwp);
  expect((await call(member.token, 'GET', docs + '/events')).json().events.map((entry: { id: string }) => entry.id)).toContain(first);
  expect((await call(member.token, 'GET', docs + '?eventId=' + first)).json().files.map((file: { id: string }) => file.id))
    .toEqual(expect.arrayContaining([pdfUpload.id, hwpUpload.id]));
  expect((await call(member.token, 'GET', docs + '?eventId=' + second)).json().files).toEqual([]);
  expect((await call(member.token, 'GET', docs + '?q=회의록')).json().files).toHaveLength(2);
  expect((await call(outsider.token, 'GET', `/groups/${other.json().id}/documents/files/${pdfUpload.id}/download`)).statusCode).toBe(404);
  expect((await call(chair.token, 'GET', `${docs}/files/${hwpUpload.id}/download`)).json().url)
    .toBe(`https://storage.test/get/${encodeURIComponent(storedHwp![0])}`);

  const hwpxUpload = await staged('회의.hwpx', hwpx, { eventId: first, mimeType: 'application/hwp+zip' });
  expect((await hwpxUpload.complete()).statusCode).toBe(200);
  expect((await call(member.token, 'DELETE', `${docs}/files/${hwpxUpload.id}`)).statusCode).toBe(200);

  const same = await staged('중복.pdf', pdf, { eventId: first });
  expect((await same.complete()).json().id).toBe(pdfUpload.id);
  const otherEvent = await staged('중복.pdf', pdf, { eventId: second });
  expect((await otherEvent.complete()).json().error.code).toBe('DOCUMENT_DUPLICATE');
  const mismatch = await staged('잘못된파일.pdf', Buffer.from('plain text'), { folderId: child });
  expect((await mismatch.complete()).statusCode).toBe(415);
  expect((await call(member.token, 'PATCH', `${docs}/files/${pdfUpload.id}`, { name: '변경.pdf' })).statusCode).toBe(403);
  expect((await call(chair.token, 'PATCH', `${docs}/files/${pdfUpload.id}`, { name: '변경.pdf', location: { folderId: child } })).statusCode).toBe(200);
  expect((await call(chair.token, 'GET', docs + '?folderId=' + child + '&sort=name')).json().files[0].name).toBe('변경.pdf');
  expect((await call(chair.token, 'DELETE', docs + '/folders/' + child)).statusCode).toBe(409);

  const financeYear = (await prisma.gatheringFinanceYear.findFirstOrThrow({ where: { groupId } })).id;
  const mediaBytes = STORAGE_QUOTA_BYTES - 4096;
  await prisma.gatheringMediaAsset.create({ data: {
    groupId, eventId: first, kind: 'PHOTO', mimeType: 'image/jpeg', status: 'READY',
    storageKey: groupId + '/test-media', uploaderUserId: chair.id, sizeBytes: BigInt(mediaBytes),
  } });
  await prisma.gatheringReceiptAsset.create({ data: {
    groupId, financeYearId: financeYear, mimeType: 'application/pdf', status: 'READY',
    storageKey: groupId + '/test-receipt', uploadedByUserId: chair.id, sizeBytes: 2048n,
  } });
  expect(await loadBillableUsage(prisma, groupId, new Date())).toEqual({
    mediaBytes, receiptBytes: 2048, otherBytes: pdf.length + hwp.length,
  });
  expect((await call(member.token, 'POST', docs + '/uploads', { name: '한도.txt', sizeBytes: 2048 })).json().error.code)
    .toBe('STORAGE_QUOTA');

  await prisma.gatheringSubscription.updateMany({ where: { groupId }, data: { expiresAt: new Date(now - 1) } });
  expect((await call(member.token, 'POST', docs + '/uploads', { name: '만료.txt', sizeBytes: 4 })).json().error.code)
    .toBe('ENTITLEMENT_REQUIRED');
  expect((await call(member.token, 'GET', `${docs}/files/${pdfUpload.id}/download`)).statusCode).toBe(200);
  expect((await call(member.token, 'DELETE', `${docs}/files/${pdfUpload.id}`)).statusCode).toBe(200);
  expect((await call(member.token, 'GET', `${docs}/files/${pdfUpload.id}/download`)).statusCode).toBe(404);
  expect((await loadBillableUsage(prisma, groupId, new Date())).otherBytes).toBe(hwp.length);
  await cleanDocumentObjects(new Date(Date.now() + UPLOAD_INTENT_TTL_MS + 1000));
  expect([...storage.objects.values()]).toEqual([hwp]);
  const audit = await prisma.gatheringAuditLog.findMany({ where: { groupId, targetId: pdfUpload.id }, select: { action: true } });
  expect(audit.map(({ action }) => action)).toEqual(expect.arrayContaining(['DOCUMENT_UPLOAD', 'DOCUMENT_UPDATE', 'DOCUMENT_DELETE']));
});
