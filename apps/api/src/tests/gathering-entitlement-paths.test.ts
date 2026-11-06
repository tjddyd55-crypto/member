import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ANNUAL_GROUP_FEE_WON } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';

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
  storage = new MemoryObjectStorage();
  useObjectStorage(storage);
});

afterAll(async () => {
  useObjectStorage('default');
  await cleanup();
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

function pdf(size: number) {
  const body = Buffer.alloc(size, 0x20);
  body.write('%PDF-1.4', 0);
  return body;
}

async function register(name: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: { name, phone, password: 'Passw0rd!', localJcName: '서울테스트', directoryConsent: true },
  });
  expect(res.statusCode).toBe(200);
  userIds.push(res.json().user.id);
  return res.json() as { tokens: { accessToken: string }; user: { id: string } };
}

describe('이용 기간과 정지의 조회·쓰기 경계', () => {
  it('만료와 정지는 새 쓰기와 확정을 막고, 조회·다운로드와 생성자·인계·예전 금액은 남긴다', async () => {
    expect(ANNUAL_GROUP_FEE_WON).toBe(30_000);
    const owner = await register('경계회장');
    const successor = await register('경계차기');
    const created = await app.inject({
      method: 'POST',
      url: '/api/gathering/groups',
      headers: auth(owner.tokens.accessToken),
      payload: { name: '경계 모임' },
    });
    expect(created.statusCode).toBe(200);
    const groupId = created.json().id as string;
    groupIds.push(groupId);
    const year = created.json().financeYear.year as number;
    const instant = new Date().toISOString();
    const trial = await prisma.gatheringSubscription.findFirstOrThrow({
      where: { groupId, source: 'TRIAL' },
    });
    expect(trial.expiresAt.getTime() - trial.startsAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    const createdBy = await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(createdBy.createdByUserId).toBe(owner.user.id);

    const invite = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/invites`,
      headers: auth(owner.tokens.accessToken),
      payload: {},
    });
    expect(invite.statusCode).toBe(200);
    const joined = await app.inject({
      method: 'POST',
      url: `/api/gathering/invites/${invite.json().token}/accept`,
      headers: auth(successor.tokens.accessToken),
      payload: { directoryConsent: true },
    });
    expect(joined.statusCode).toBe(200);

    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '경계 행사', startsAt: instant },
    });
    expect(event.statusCode).toBe(200);
    const eventId = event.json().id as string;
    const entry = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '참가비', amountWon: 1000, paidAt: instant },
    });
    expect(entry.statusCode).toBe(200);
    const transactionId = entry.json().id as string;
    const due = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/finance/dues`,
      headers: auth(owner.tokens.accessToken),
      payload: { userId: successor.user.id, year, amountWon: ANNUAL_GROUP_FEE_WON, paidAmountWon: 0 },
    });
    expect(due.statusCode).toBe(200);
    const handover = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/handover`,
      headers: auth(owner.tokens.accessToken),
      payload: { toUserId: successor.user.id, idempotencyKey: `hand-${groupId}` },
    });
    expect(handover.statusCode).toBe(200);
    const handoverId = handover.json().id as string;

    const readyUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 32 }] },
    });
    expect(readyUpload.statusCode).toBe(200);
    const readyId = readyUpload.json().items[0].id as string;
    const readyRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: readyId } });
    storage.put(`${readyRow.storageKey}-pending`, jpeg(32));
    expect((await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media/${readyId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    })).statusCode).toBe(200);

    const pendingUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 40 }] },
    });
    const pendingId = pendingUpload.json().items[0].id as string;
    const pendingRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: pendingId } });
    storage.put(`${pendingRow.storageKey}-pending`, jpeg(40));

    const folder = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '경계 폴더' },
    });
    expect(folder.statusCode).toBe(200);
    const folderId = folder.json().id as string;
    const folderUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/folders/${folderId}/media/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 24 }] },
    });
    const folderAssetId = folderUpload.json().items[0].id as string;
    const folderRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: folderAssetId } });
    storage.put(`${folderRow.storageKey}-pending`, jpeg(24));

    const link = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/upload-links`,
      headers: auth(owner.tokens.accessToken),
      payload: { eventId },
    });
    expect(link.statusCode).toBe(200);
    const token = link.json().token as string;
    const guest = await app.inject({
      method: 'POST',
      url: `/api/gathering/public/uploads/${token}/reserve`,
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 16 }] },
    });
    expect(guest.statusCode).toBe(200);
    const guestId = guest.json().items[0].id as string;
    const guestRow = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: guestId } });
    storage.put(`${guestRow.storageKey}-pending`, jpeg(16));

    const receipts = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }, { mimeType: 'application/pdf', sizeBytes: 28 }] },
    });
    expect(receipts.statusCode).toBe(200);
    const readyReceiptId = receipts.json().items[0].id as string;
    const pendingReceiptId = receipts.json().items[1].id as string;
    const readyReceipt = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: readyReceiptId } });
    const pendingReceipt = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: pendingReceiptId } });
    storage.put(readyReceipt.storageKey, pdf(32));
    storage.put(pendingReceipt.storageKey, pdf(28));
    expect((await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events/${eventId}/receipts/${readyReceiptId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    })).statusCode).toBe(200);

    await prisma.gatheringSubscription.update({
      where: { id: trial.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectWrites(owner.tokens.accessToken, groupId, eventId, transactionId, year, successor.user.id, folderId, pendingId, folderAssetId, pendingReceiptId, token, guestId, 'ENTITLEMENT_REQUIRED');
    await expectReads(owner.tokens.accessToken, groupId, eventId, readyId, readyReceiptId);
    const expiredView = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/subscription`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(expiredView.json().uploadsAllowed).toBe(false);
    expect(expiredView.json().status).toBe('EXPIRED');

    await prisma.gatheringSubscription.update({
      where: { id: trial.id },
      data: { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), status: 'ACTIVE' },
    });
    await prisma.gatheringGroup.update({ where: { id: groupId }, data: { suspendedAt: new Date() } });
    await expectWrites(owner.tokens.accessToken, groupId, eventId, transactionId, year, successor.user.id, folderId, pendingId, folderAssetId, pendingReceiptId, token, guestId, 'SUSPENDED');
    await expectReads(owner.tokens.accessToken, groupId, eventId, readyId, readyReceiptId);
    const suspendedView = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${groupId}/subscription`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(suspendedView.json().uploadsAllowed).toBe(false);
    expect(suspendedView.json().suspended).toBe(true);
    expect(JSON.stringify(suspendedView.json())).not.toContain('accountNumber');

    const stillOwner = await prisma.gatheringGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(stillOwner.createdByUserId).toBe(owner.user.id);
    const stillHandover = await prisma.gatheringHandover.findUniqueOrThrow({ where: { id: handoverId } });
    expect(stillHandover.status).toBe('NOMINATED');
    expect(stillHandover.toUserId).toBe(successor.user.id);
    const stillDue = await prisma.gatheringMemberDue.findFirstOrThrow({ where: { groupId, userId: successor.user.id } });
    expect(stillDue.amountWon).toBe(ANNUAL_GROUP_FEE_WON);
    const stillReady = await prisma.gatheringMediaAsset.findUniqueOrThrow({ where: { id: readyId } });
    expect(stillReady.status).toBe('READY');
    expect(stillReady.deletedAt).toBeNull();
    const stillPending = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: pendingReceiptId } });
    expect(stillPending.status).toBe('PENDING');

    await prisma.gatheringGroup.update({ where: { id: groupId }, data: { suspendedAt: null } });
    const reopened = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${groupId}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '다시 연 행사', startsAt: instant },
    });
    expect(reopened.statusCode).toBe(200);
  });
});

async function expectWrites(
  token: string,
  groupId: string,
  eventId: string,
  transactionId: string,
  year: number,
  memberId: string,
  folderId: string,
  pendingId: string,
  folderAssetId: string,
  pendingReceiptId: string,
  publicToken: string,
  guestId: string,
  code: string,
) {
  const headers = auth(token);
  const calls: Array<{ method: string; url: string; payload?: unknown }> = [
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events`, payload: { title: '막힌 행사', startsAt: new Date().toISOString() } },
    { method: 'PATCH', url: `/api/gathering/groups/${groupId}/events/${eventId}`, payload: { title: '고친 행사' } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/finance/dues`, payload: { userId: memberId, year, amountWon: 1000, paidAmountWon: 0 } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/transactions`, payload: { direction: 'EXPENSE', label: '막힌 지출', amountWon: 10, paidAt: new Date().toISOString() } },
    { method: 'PUT', url: `/api/gathering/groups/${groupId}/transactions/${transactionId}`, payload: { direction: 'INCOME', label: '고친 수입', amountWon: 1000, paidAt: new Date().toISOString() } },
    { method: 'DELETE', url: `/api/gathering/groups/${groupId}/transactions/${transactionId}` },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`, payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 8 }] } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/media/${pendingId}/complete`, payload: { sizeBytes: 40 } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/media/${pendingId}/resume` },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/folders/${folderId}/media/uploads`, payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 8 }] } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/folders/${folderId}/media/${folderAssetId}/complete`, payload: { sizeBytes: 24 } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/folders/${folderId}/media/${folderAssetId}/resume` },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/receipts/uploads`, payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 12 }] } },
    { method: 'POST', url: `/api/gathering/groups/${groupId}/events/${eventId}/receipts/${pendingReceiptId}/complete`, payload: { sizeBytes: 28 } },
  ];
  for (const call of calls) {
    const res = await app.inject({ method: call.method as 'POST', url: call.url, headers, payload: call.payload });
    expect(res.statusCode, `${call.method} ${call.url}`).toBe(409);
    expect(res.json().error.code, `${call.method} ${call.url}`).toBe(code);
  }
  const guestReserve = await app.inject({
    method: 'POST',
    url: `/api/gathering/public/uploads/${publicToken}/reserve`,
    payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 8 }] },
  });
  expect(guestReserve.statusCode).toBe(409);
  expect(guestReserve.json().error.code).toBe(code);
  const guestComplete = await app.inject({
    method: 'POST',
    url: `/api/gathering/public/uploads/${publicToken}/complete`,
    payload: { assetId: guestId, sizeBytes: 16 },
  });
  expect(guestComplete.statusCode).toBe(409);
  expect(guestComplete.json().error.code).toBe(code);
}

async function expectReads(token: string, groupId: string, eventId: string, mediaId: string, receiptId: string) {
  const headers = auth(token);
  const from = '2020-01-01T00:00:00.000Z';
  const to = '2035-01-01T00:00:00.000Z';
  const paths = [
    `/api/gathering/groups/${groupId}`,
    `/api/gathering/groups/${groupId}/events?from=${from}&to=${to}`,
    `/api/gathering/groups/${groupId}/events/${eventId}`,
    `/api/gathering/groups/${groupId}/events/${eventId}/media`,
    `/api/gathering/groups/${groupId}/media/${mediaId}/download`,
    `/api/gathering/groups/${groupId}/albums`,
    `/api/gathering/groups/${groupId}/events/${eventId}/receipts`,
    `/api/gathering/groups/${groupId}/receipts/${receiptId}/download`,
    `/api/gathering/groups/${groupId}/events/${eventId}/transactions`,
    `/api/gathering/groups/${groupId}/finance`,
    `/api/gathering/groups/${groupId}/subscription`,
    `/api/gathering/groups/${groupId}/handover`,
    `/api/gathering/groups/${groupId}/storage`,
  ];
  for (const url of paths) {
    const res = await app.inject({ method: 'GET', url, headers });
    expect(res.statusCode, url).toBe(200);
  }
}

async function cleanup() {
  if (groupIds.length === 0) return;
  await prisma.gatheringMemberDue.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringUploadLink.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaFolder.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringEventAttendance.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringRoleAssignment.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringExecutiveTerm.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringInvite.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMembership.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  if (userIds.length === 0) return;
  await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
