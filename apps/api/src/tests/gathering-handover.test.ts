import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { fiscalYearRange } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { currentOperatorSecret } from '../modules/gathering/subscription/service.js';
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

async function createGroup(token: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: auth(token),
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  groupIds.push(res.json().id);
  return res.json() as { id: string; financeYear: { year: number } };
}

async function join(ownerToken: string, memberToken: string, groupId: string) {
  const invite = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/invites`,
    headers: auth(ownerToken),
    payload: {},
  });
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/gathering/invites/${invite.json().token}/accept`,
    headers: auth(memberToken),
    payload: { directoryConsent: true },
  });
  expect(accepted.statusCode).toBe(200);
}

describe('회계 마감과 인계', () => {
  it('확인 순서와 단일 마감으로 잔액을 넘기고 지난 해 수정은 거절한다', async () => {
    const owner = await register('인계회장');
    const next = await register('차기회장');
    const member = await register('인계회원');
    const group = await createGroup(owner.tokens.accessToken, '인계 모임');
    await join(owner.tokens.accessToken, next.tokens.accessToken, group.id);
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const event = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events`,
      headers: auth(owner.tokens.accessToken),
      payload: { title: '송년', startsAt: '2026-12-20T12:00:00.000Z' },
    });
    const eventId = event.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '회비', amountWon: 10000, paidAt: '2026-12-20T12:00:00.000Z' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'EXPENSE', label: '식대', amountWon: 3000, paidAt: '2026-12-21T01:00:00.000Z' },
    });
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 24 }] },
    });
    const receiptId = uploaded.json().items[0].id as string;
    const stored = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receiptId } });
    storage.put(stored.storageKey, pdf(24));
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/receipts/${receiptId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 24 },
    });

    const denied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(member.tokens.accessToken),
      payload: { toUserId: next.user.id, idempotencyKey: 'handover-key-0001' },
    });
    expect(denied.statusCode).toBe(403);
    const nominated = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
      payload: { toUserId: next.user.id, idempotencyKey: 'handover-key-0001' },
    });
    expect(nominated.statusCode).toBe(200);
    const handoverId = nominated.json().id as string;
    const tooSoon = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(tooSoon.statusCode).toBe(409);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/accept`,
      headers: auth(next.tokens.accessToken),
    });
    expect(accepted.json().status).toBe('ACCEPTED');
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/confirm`,
      headers: auth(owner.tokens.accessToken),
      payload: { incomeWon: 1, expenseWon: 1, balanceWon: 0, dueCount: 0, receiptCount: 0 },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('CONFIRM_MISMATCH');
    const view = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(view.json().preview.balanceWon).toBe(7000);
    expect(view.json().preview.receiptCount).toBe(1);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/confirm`,
      headers: auth(owner.tokens.accessToken),
      payload: view.json().preview,
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'EXPENSE', label: '추가', amountWon: 500, paidAt: '2026-12-21T02:00:00.000Z' },
    });
    const stale = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('HANDOVER_STALE');
    const again = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/confirm`,
      headers: auth(owner.tokens.accessToken),
      payload: again.json().preview,
    });
    expect(confirmed.statusCode).toBe(200);
    const closed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().balanceWon).toBe(6500);
    const replay = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(replay.json().snapshotId).toBe(closed.json().snapshotId);
    expect(replay.json().idempotent).toBe(true);
    const snapshots = await prisma.gatheringFinanceCloseSnapshot.count({ where: { groupId: group.id } });
    expect(snapshots).toBe(1);
    const president = await prisma.gatheringRoleAssignment.findFirst({
      where: { groupId: group.id, role: 'PRESIDENT', revokedAt: null },
    });
    expect(president?.userId).toBe(next.user.id);
    const nextYear = await prisma.gatheringFinanceYear.findFirst({
      where: { groupId: group.id, status: 'OPEN' },
    });
    expect(nextYear?.openingBalanceWon).toBe(6500);
    const locked = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/transactions`,
      headers: auth(next.tokens.accessToken),
      payload: { direction: 'EXPENSE', label: '지난 해', amountWon: 1000, paidAt: '2026-12-21T03:00:00.000Z' },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('FINANCE_YEAR_CLOSED');
    const range = fiscalYearRange(nextYear?.year ?? 0);
    const adjustment = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/transactions`,
      headers: auth(next.tokens.accessToken),
      payload: {
        direction: 'EXPENSE',
        label: '전년 정정',
        amountWon: 200,
        paidAt: range.startsAt.toISOString(),
        adjustment: true,
        note: '마감 후 식대 정정',
      },
    });
    expect(adjustment.statusCode).toBe(200);
    expect(adjustment.json().fiscalYear).toBe(nextYear?.year);
    const receiptGone = await app.inject({
      method: 'DELETE',
      url: `/api/gathering/groups/${group.id}/receipts/${receiptId}`,
      headers: auth(next.tokens.accessToken),
    });
    expect(receiptGone.statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/admin/groups/${group.id}/subscription`,
      headers: { ...auth(next.tokens.accessToken), 'x-gathering-operator-secret': currentOperatorSecret() },
      payload: { source: 'COMPLIMENTARY', idempotencyKey: `pass-${group.id}` },
    });
    const photo = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${eventId}/media/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 16 }] },
    });
    expect(photo.statusCode).toBe(200);
  });

  it('동시에 최종 승인해도 스냅샷은 하나다', async () => {
    const owner = await register('동시회장');
    const next = await register('동시차기');
    const group = await createGroup(owner.tokens.accessToken, '동시 인계');
    await join(owner.tokens.accessToken, next.tokens.accessToken, group.id);
    const nominated = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
      payload: { toUserId: next.user.id, idempotencyKey: 'handover-race-0001' },
    });
    const handoverId = nominated.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/accept`,
      headers: auth(next.tokens.accessToken),
    });
    const view = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/handover`,
      headers: auth(owner.tokens.accessToken),
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/handover/${handoverId}/confirm`,
      headers: auth(owner.tokens.accessToken),
      payload: view.json().preview,
    });
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
        headers: auth(owner.tokens.accessToken),
      }),
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/handover/${handoverId}/finalize`,
        headers: auth(owner.tokens.accessToken),
      }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().snapshotId).toBe(second.json().snapshotId);
    const snapshots = await prisma.gatheringFinanceCloseSnapshot.count({ where: { groupId: group.id } });
    expect(snapshots).toBe(1);
  });
});

async function cleanup() {
  if (groupIds.length === 0) return;
  await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMemberDue.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceCloseSnapshot.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
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
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
