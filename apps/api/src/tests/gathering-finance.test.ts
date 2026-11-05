import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { fiscalYearRange } from '@member/gathering-domain';
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
    payload: { requiresApproval: false },
  });
  const accepted = await app.inject({
    method: 'POST',
    url: `/api/gathering/invites/${invite.json().token}/accept`,
    headers: auth(memberToken),
    payload: { directoryConsent: true },
  });
  expect(accepted.statusCode).toBe(200);
}

async function createEvent(token: string, groupId: string, startsAt: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/events`,
    headers: auth(token),
    payload: { title: '정산 행사', startsAt },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string };
}

describe('행사 장부와 영수증', () => {
  it('회장과 재무만 항목을 고치고, 결제일이 행사 다음날이면 같은 행사에 귀속한다', async () => {
    const owner = await register('장부회장');
    const treasurer = await register('장부재무');
    const secretary = await register('장부총무');
    const member = await register('장부회원');
    const group = await createGroup(owner.tokens.accessToken, '장부 모임');
    await join(owner.tokens.accessToken, treasurer.tokens.accessToken, group.id);
    await join(owner.tokens.accessToken, secretary.tokens.accessToken, group.id);
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(owner.tokens.accessToken),
      payload: { userId: treasurer.user.id, role: 'TREASURER' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/officers`,
      headers: auth(owner.tokens.accessToken),
      payload: { userId: secretary.user.id, role: 'SECRETARY' },
    });
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-10-28T12:00:00.000Z');
    const payload = {
      direction: 'EXPENSE',
      label: '식대',
      amountWon: 48000,
      paidAt: '2026-10-28T15:40:00.000Z',
      note: '다음날 새벽 결제',
    };
    const denied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(secretary.tokens.accessToken),
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const memberDenied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(member.tokens.accessToken),
      payload,
    });
    expect(memberDenied.statusCode).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(treasurer.tokens.accessToken),
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().fiscalYear).toBe(2026);
    expect(created.json().eventId).toBe(event.id);
    const income = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '회비', amountWon: 100000, paidAt: '2026-10-28T12:00:00.000Z' },
    });
    expect(income.statusCode).toBe(200);
    await prisma.gatheringFinanceYear.update({
      where: { groupId_year: { groupId: group.id, year: group.financeYear.year } },
      data: { openingBalanceWon: 2000 },
    });
    const summary = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance`,
      headers: auth(member.tokens.accessToken),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().incomeWon).toBe(100000);
    expect(summary.json().expenseWon).toBe(48000);
    expect(summary.json().balanceWon).toBe(54000);
    const due = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/finance/dues`,
      headers: auth(treasurer.tokens.accessToken),
      payload: { userId: member.user.id, year: group.financeYear.year, amountWon: 30000, paidAmountWon: 10000 },
    });
    expect(due.json().status).toBe('PARTIAL');
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance`,
      headers: auth(member.tokens.accessToken),
    });
    expect(listed.json().dues[0].paidAmountWon).toBe(10000);
    expect(listed.json().dues[0].displayName).toBe('장부회원');
  });

  it('12월 24일 결제는 다음 회계연도이고, 마감된 해는 고칠 수 없다', async () => {
    const owner = await register('경계회장');
    const group = await createGroup(owner.tokens.accessToken, '경계 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-12-23T13:00:00.000Z');
    const missing = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'EXPENSE', label: '심야 택시', amountWon: 18000, paidAt: '2026-12-23T15:30:00.000Z' },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('FINANCE_YEAR_NOT_OPEN');
    const range = fiscalYearRange(2027);
    await prisma.gatheringFinanceYear.create({
      data: {
        groupId: group.id,
        year: 2027,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        status: 'OPEN',
        openingBalanceWon: 0,
      },
    });
    const crossed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        direction: 'EXPENSE',
        label: '심야 택시',
        amountWon: 18000,
        paidAt: '2026-12-23T15:30:00.000Z',
        adjustment: true,
        note: '전년 행사 비용을 다음 해에 정정',
      },
    });
    expect(crossed.statusCode).toBe(200);
    expect(crossed.json().fiscalYear).toBe(2027);
    const noNote = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'EXPENSE', label: '정정', amountWon: 1000, paidAt: '2026-12-23T15:30:00.000Z', adjustment: true },
    });
    expect(noNote.statusCode).toBe(400);
    await prisma.gatheringFinanceYear.update({
      where: { groupId_year: { groupId: group.id, year: 2027 } },
      data: { status: 'CLOSED' },
    });
    const locked = await app.inject({
      method: 'PUT',
      url: `/api/gathering/groups/${group.id}/transactions/${crossed.json().id}`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        direction: 'EXPENSE',
        label: '심야 택시',
        amountWon: 19000,
        paidAt: '2026-12-23T15:30:00.000Z',
        note: '마감 후 수정',
      },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('FINANCE_YEAR_CLOSED');
  });

  it('회원은 영수증을 보고, 재무만 여러 장을 첨부한다. 이용권이 없어도 한도 안이면 된다', async () => {
    const owner = await register('영수증회장');
    const member = await register('영수증회원');
    const group = await createGroup(owner.tokens.accessToken, '영수증 모임');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-05-02T03:00:00.000Z');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
      headers: auth(member.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
    });
    expect(denied.statusCode).toBe(403);
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        items: [
          { mimeType: 'application/pdf', sizeBytes: 32, originalName: '1.pdf' },
          { mimeType: 'application/pdf', sizeBytes: 40, originalName: '2.pdf' },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().items).toHaveLength(2);
    const first = created.json().items[0];
    const row = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.storageKey).toContain(`/events/${event.id}/receipts/`);
    storage.put(row.storageKey, pdf(32));
    const ready = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${first.id}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(ready.statusCode).toBe(200);
    const list = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts`,
      headers: auth(member.tokens.accessToken),
    });
    expect(list.json().items).toHaveLength(1);
    const download = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/receipts/${first.id}/download`,
      headers: auth(member.tokens.accessToken),
    });
    expect(download.statusCode).toBe(200);
    const usage = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/storage`,
      headers: auth(member.tokens.accessToken),
    });
    expect(usage.json().receiptBytes).toBe(72);
    expect(usage.json().usedBytes).toBe(72);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/gathering/groups/${group.id}/receipts/${first.id}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(removed.statusCode).toBe(403);
  });

  it('오프셋 결제일을 받고, 영수증 확정은 예약한 회계연도를 본다', async () => {
    const owner = await register('오프셋회장');
    const group = await createGroup(owner.tokens.accessToken, '오프셋 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-10-28T12:00:00.000Z');
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        direction: 'EXPENSE',
        label: '새벽 결제',
        amountWon: 9000,
        paidAt: '2026-10-29T00:40:00.000+09:00',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().fiscalYear).toBe(2026);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
    });
    const receiptId = uploaded.json().items[0].id as string;
    const row = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receiptId } });
    const reservedYear = row.financeYearId;
    await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}/events/${event.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { startsAt: '2026-12-24T15:00:00.000Z' },
    });
    storage.put(row.storageKey, pdf(32));
    const ready = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${receiptId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(ready.statusCode).toBe(200);
    const saved = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receiptId } });
    expect(saved.financeYearId).toBe(reservedYear);
    expect(saved.status).toBe('READY');
  });

  it('빈 해의 시작일만 바꾸고, 회비 납부는 행사 수입과 따로 한 번만 합친다', async () => {
    const owner = await register('기간회장');
    const group = await createGroup(owner.tokens.accessToken, '기간 모임');
    const shifted = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 6, fiscalStartDay: 1 },
    });
    expect(shifted.statusCode).toBe(200);
    expect(shifted.json().financeYear.startsAt).toBe('2025-05-31T15:00:00.000Z');
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 4, fiscalStartDay: 31 },
    });
    expect(invalid.statusCode).toBe(400);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-01T03:00:00.000Z');
    const income = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '참가비', amountWon: 4000, paidAt: '2026-03-01T03:00:00.000Z' },
    });
    expect(income.statusCode).toBe(200);
    const locked = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 1, fiscalStartDay: 1 },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('PERIOD_LOCKED');
    const due = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/finance/dues`,
      headers: auth(owner.tokens.accessToken),
      payload: { displayName: '기간회장', year: group.financeYear.year, amountWon: 10000, paidAmountWon: 10000, paidAt: '2026-03-02T03:00:00.000Z' },
    });
    expect(due.statusCode).toBe(200);
    const summary = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(summary.json().eventIncomeWon).toBe(4000);
    expect(summary.json().duesWon).toBe(10000);
    expect(summary.json().incomeWon).toBe(14000);
    expect(summary.json().events[0].netWon).toBe(4000);
    const rows = await prisma.gatheringFinanceTransaction.count({ where: { groupId: group.id } });
    expect(rows).toBe(1);
  });
});

async function cleanup() {
  if (groupIds.length === 0) return;
  await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMemberDue.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaReport.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringNotification.deleteMany({ where: { groupId: { in: groupIds } } });
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
