import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { fiscalYearOf, fiscalYearRange, summarizeFinance } from '@member/gathering-domain';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';
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
  gatheringAuthLimiter.reset();
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
    payload: {
      name,
      phone,
      password: 'Passw0rd!',
      localJcName: '서울테스트',
      directoryConsent: true,
    },
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

describe('회계연도 달력 정렬 마이그레이션', () => {
  it('열린 연도와 마감 연도의 범위만 정렬하고 원본을 한 번만 백업한다', async () => {
    const owner = await register('달력정렬회장');
    const group = await createGroup(owner.tokens.accessToken, '달력 정렬 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-02T03:00:00.000Z');
    const sql = await readFile(
      new URL(
        '../../../../prisma/migrations/20261122140000_gathering_finance_year_calendar_align/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const rollback = new Error('Roll back migration test data');

    // The migration scans all groups. Roll it back to leave other test DB rows untouched.
    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
          const legacyRange = (year: number) => ({
            startsAt: new Date(`${year - 1}-12-23T15:00:00.000Z`),
            endsAt: new Date(`${year}-12-23T14:59:59.999Z`),
          });
          const open = await tx.gatheringFinanceYear.update({
            where: { groupId_year: { groupId: group.id, year: group.financeYear.year } },
            data: { year: 2026, ...legacyRange(2026), openingBalanceWon: 1000 },
          });
          const closed = await tx.gatheringFinanceYear.create({
            data: {
              groupId: group.id,
              year: 2024,
              status: 'CLOSED',
              ...legacyRange(2024),
              openingBalanceWon: 500,
              closedAt: new Date('2024-12-24T00:00:00.000Z'),
            },
          });
          const lateDecember = new Date('2025-12-25T01:00:00+09:00');
          const entry = { groupId: group.id, createdByUserId: owner.user.id, eventId: event.id };
          const transactions = await tx.gatheringFinanceTransaction.createManyAndReturn({
            data: [
              {
                ...entry,
                financeYearId: open.id,
                direction: 'INCOME',
                label: '행사 수입',
                amountWon: 5000,
                paidAt: new Date('2026-03-02T03:00:00Z'),
              },
              {
                ...entry,
                financeYearId: open.id,
                direction: 'EXPENSE',
                label: '12월 행사 지출',
                amountWon: 2000,
                paidAt: lateDecember,
              },
              {
                ...entry,
                eventId: null,
                financeYearId: closed.id,
                direction: 'INCOME',
                label: '마감 수입',
                amountWon: 3000,
                paidAt: new Date('2024-03-02T03:00:00Z'),
              },
            ],
          });
          const due = await tx.gatheringMemberDue.create({
            data: {
              groupId: group.id,
              userId: owner.user.id,
              financeYearId: open.id,
              amountWon: 700,
              paidAmountWon: 700,
              paidAt: lateDecember,
              status: 'PAID',
            },
          });
          const receipt = await tx.gatheringReceiptAsset.create({
            data: {
              groupId: group.id,
              eventId: event.id,
              financeYearId: open.id,
              uploadedByUserId: owner.user.id,
              storageKey: `calendar-test/${group.id}`,
              mimeType: 'application/pdf',
              sizeBytes: 32,
            },
          });
          const snapshot = await tx.gatheringFinanceCloseSnapshot.create({
            data: {
              groupId: group.id,
              financeYearId: closed.id,
              closedByUserId: owner.user.id,
              payloadJson: JSON.stringify({ ...legacyRange(2024), closingBalanceWon: 3500 }),
              contentHash: 'legacy-test-hash',
            },
          });

          async function summarizeYear(id: string) {
            const year = await tx.gatheringFinanceYear.findUniqueOrThrow({ where: { id } });
            const entries = await tx.gatheringFinanceTransaction.findMany({
              where: { financeYearId: id },
            });
            const dues = await tx.gatheringMemberDue.findMany({ where: { financeYearId: id } });
            return summarizeFinance({
              openingBalanceWon: year.openingBalanceWon,
              entries,
              duesPaidWon: dues.reduce((total, item) => total + item.paidAmountWon, 0),
            });
          }

          const openTotals = await summarizeYear(open.id);
          const closedTotals = await summarizeYear(closed.id);
          expect(openTotals).toMatchObject({
            incomeWon: 5700,
            expenseWon: 2000,
            balanceWon: 4700,
            eventIncomeWon: 5000,
          });
          expect(closedTotals).toMatchObject({
            incomeWon: 3000,
            expenseWon: 0,
            balanceWon: 3500,
            eventIncomeWon: 0,
          });

          await tx.$executeRawUnsafe(sql);

          for (const original of [open, closed]) {
            const year = await tx.gatheringFinanceYear.findUniqueOrThrow({
              where: { id: original.id },
            });
            expect(year).toEqual({
              ...original,
              startsAt: new Date(`${original.year - 1}-12-31T15:00:00.000Z`),
              endsAt: new Date(`${original.year}-12-31T14:59:59.999Z`),
            });
          }
          expect(lateDecember.getTime()).toBeLessThan(Date.parse('2025-12-31T15:00:00.000Z'));
          expect(
            transactions.find((item) => item.paidAt.getTime() === lateDecember.getTime())
              ?.financeYearId,
          ).toBe(open.id);
          for (const transaction of transactions) {
            expect(
              await tx.gatheringFinanceTransaction.findUniqueOrThrow({
                where: { id: transaction.id },
              }),
            ).toEqual(transaction);
          }
          expect(await tx.gatheringMemberDue.findUniqueOrThrow({ where: { id: due.id } })).toEqual(
            due,
          );
          expect(
            await tx.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receipt.id } }),
          ).toEqual(receipt);
          expect(
            await tx.gatheringFinanceCloseSnapshot.findUniqueOrThrow({
              where: { id: snapshot.id },
            }),
          ).toEqual(snapshot);
          expect(await summarizeYear(open.id)).toEqual(openTotals);
          expect(await summarizeYear(closed.id)).toEqual(closedTotals);

          const backups = () =>
            tx.gatheringFinanceYearRangeBackup.findMany({
              where: { groupId: group.id },
              orderBy: { year: 'asc' },
            });
          const originalBackups = await backups();
          expect(originalBackups).toEqual(
            [closed, open].map(({ id, closedAt, ...fields }) => ({
              ...fields,
              id: `rangbak_${id}`,
              financeYearId: id,
              backedUpAt: expect.any(Date),
            })),
          );

          // PostgreSQL assigns a new tuple location even for an UPDATE that writes identical values.
          const yearVersions = () => tx.$queryRaw`
        SELECT ctid::text, "id", "startsAt", "endsAt"
        FROM "gathering_finance_years" ORDER BY "id"
      `;
          const alignedVersions = await yearVersions();
          await tx.$executeRawUnsafe(sql);
          expect(await yearVersions()).toEqual(alignedVersions);
          expect(await backups()).toEqual(originalBackups);
          throw rollback;
        },
        { timeout: 30000 },
      ),
    ).rejects.toBe(rollback);
  });
});

describe('행사 장부와 영수증', () => {
  it('행사 수정·거래·영수증은 실제 역할별로 서버가 허용하며 일반 회원은 조회만 한다', async () => {
    const owner = await register('상세권한회장');
    const group = await createGroup(owner.tokens.accessToken, '상세 권한 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-05-02T03:00:00.000Z');
    for (const role of ['PRESIDENT', 'SECRETARY', 'TREASURER', 'EXECUTIVE', 'MEMBER'] as const) {
      const actor = role === 'PRESIDENT' ? owner : await register(`상세${role}`);
      if (role !== 'PRESIDENT') {
        await join(owner.tokens.accessToken, actor.tokens.accessToken, group.id);
        if (role !== 'MEMBER') {
          const assigned = await app.inject({
            method: 'POST',
            url: `/api/gathering/groups/${group.id}/officers`,
            headers: auth(owner.tokens.accessToken),
            payload: {
              userId: actor.user.id,
              role,
              ...(role === 'EXECUTIVE' ? { title: '기획위원' } : {}),
            },
          });
          expect(assigned.statusCode).toBe(200);
        }
      }
      const edit = await app.inject({
        method: 'PATCH',
        url: `/api/gathering/groups/${group.id}/events/${event.id}`,
        headers: auth(actor.tokens.accessToken),
        payload: {
          title: '수정된 행사',
          place: '회의실\n서울시 중구 3층',
          description: '행사 설명',
        },
      });
      expect(edit.statusCode, role).toBe(role === 'PRESIDENT' || role === 'SECRETARY' ? 200 : 403);
      const financeAllowed = role === 'PRESIDENT' || role === 'TREASURER';
      const transaction = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
        headers: auth(actor.tokens.accessToken),
        payload: {
          direction: 'EXPENSE',
          label: '식대',
          amountWon: 1000,
          paidAt: '2026-05-02T03:00:00.000Z',
        },
      });
      expect(transaction.statusCode, role).toBe(financeAllowed ? 200 : 403);
      const upload = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
        headers: auth(actor.tokens.accessToken),
        payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
      });
      expect(upload.statusCode, role).toBe(financeAllowed ? 200 : 403);
      for (const path of ['', '/transactions', '/receipts']) {
        const read = await app.inject({
          method: 'GET',
          url: `/api/gathering/groups/${group.id}/events/${event.id}${path}`,
          headers: auth(actor.tokens.accessToken),
        });
        expect(read.statusCode, `${role} ${path}`).toBe(200);
        if (!path) {
          expect(read.json().place).toBe('회의실\n서울시 중구 3층');
          expect(read.json().description).toBe('행사 설명');
        }
      }
    }
  });

  it('마감연도는 거래 추가·수정·삭제와 영수증 예약·완료·삭제를 거절하고 기존 기록을 보존한다', async () => {
    const owner = await register('상세마감회장');
    const group = await createGroup(owner.tokens.accessToken, '상세 마감 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-05-02T03:00:00.000Z');
    const payload = {
      direction: 'EXPENSE',
      label: '보존 식대',
      amountWon: 1000,
      paidAt: '2026-05-02T03:00:00.000Z',
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload,
    });
    expect(created.statusCode).toBe(200);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        items: Array.from({ length: 3 }, () => ({ mimeType: 'application/pdf', sizeBytes: 32 })),
      },
    });
    expect(upload.statusCode).toBe(200);
    const [readyId, pendingId, expiredId] = upload
      .json()
      .items.map((item: { id: string }) => item.id) as string[];
    const ready = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: readyId } });
    storage.put(ready.storageKey, pdf(32));
    const complete = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${readyId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(complete.statusCode).toBe(200);
    await prisma.gatheringReceiptAsset.update({
      where: { id: expiredId },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const pending = await prisma.gatheringReceiptAsset.findUniqueOrThrow({
      where: { id: pendingId },
    });
    storage.put(pending.storageKey, Buffer.alloc(33)); // Invalid object must not mark a closed year's row FAILED.
    const before = await prisma.gatheringReceiptAsset.findMany({
      where: { groupId: group.id },
      orderBy: { id: 'asc' },
    });
    const originalTransaction = await prisma.gatheringFinanceTransaction.findUniqueOrThrow({
      where: { id: created.json().id },
    });
    await prisma.gatheringFinanceYear.update({
      where: { id: ready.financeYearId },
      data: { status: 'CLOSED' },
    });
    const next = fiscalYearRange(group.financeYear.year + 1);
    await prisma.gatheringFinanceYear.create({
      data: {
        groupId: group.id,
        year: group.financeYear.year + 1,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        status: 'OPEN',
        openingBalanceWon: 0,
      },
    });
    const deniedWrites = [
      {
        method: 'POST' as const,
        url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
        payload,
      },
      {
        method: 'PUT' as const,
        url: `/api/gathering/groups/${group.id}/transactions/${created.json().id}`,
        payload: { ...payload, paidAt: next.startsAt.toISOString(), amountWon: 2000 },
      },
      {
        method: 'DELETE' as const,
        url: `/api/gathering/groups/${group.id}/transactions/${created.json().id}`,
      },
      {
        method: 'POST' as const,
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
        payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
      },
      ...[pendingId, expiredId].map((id) => ({
        method: 'POST' as const,
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${id}/complete`,
        payload: { sizeBytes: 32 },
      })),
    ];
    for (const write of deniedWrites) {
      const result = await app.inject({ ...write, headers: auth(owner.tokens.accessToken) });
      expect(result.statusCode, write.url).toBe(409);
      expect(result.json().error.code).toBe('FINANCE_YEAR_CLOSED');
    }
    for (const id of [readyId, pendingId]) {
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/gathering/groups/${group.id}/receipts/${id}`,
        headers: auth(owner.tokens.accessToken),
      });
      expect(deleted.statusCode).toBe(403);
    }
    expect(
      await prisma.gatheringReceiptAsset.findMany({
        where: { groupId: group.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      await prisma.gatheringFinanceTransaction.findUniqueOrThrow({
        where: { id: created.json().id },
      }),
    ).toEqual(originalTransaction);
    expect(storage.objects.has(ready.storageKey)).toBe(true);
    for (const path of ['transactions', 'receipts']) {
      const read = await app.inject({
        method: 'GET',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/${path}`,
        headers: auth(owner.tokens.accessToken),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().items).toHaveLength(1);
    }
  });

  it.each([true, false])(
    '저장소 확인 도중 마감되면 영수증 상태를 변경하지 않는다 (정상 파일: %s)',
    async (valid) => {
      const owner = await register(`마감경쟁${valid}`);
      const group = await createGroup(owner.tokens.accessToken, '영수증 완료 마감 경쟁');
      const event = await createEvent(
        owner.tokens.accessToken,
        group.id,
        '2026-05-02T03:00:00.000Z',
      );
      const upload = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
        headers: auth(owner.tokens.accessToken),
        payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
      });
      expect(upload.statusCode).toBe(200);
      const receipt = await prisma.gatheringReceiptAsset.findUniqueOrThrow({
        where: { id: upload.json().items[0].id },
      });
      storage.put(receipt.storageKey, valid ? pdf(32) : Buffer.alloc(33));
      const originalHead = storage.head.bind(storage);
      storage.head = async (key) => {
        await prisma.gatheringFinanceYear.update({
          where: { id: receipt.financeYearId },
          data: { status: 'CLOSED' },
        });
        return originalHead(key);
      };
      const complete = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${receipt.id}/complete`,
        headers: auth(owner.tokens.accessToken),
        payload: { sizeBytes: 32 },
      });
      expect(complete.statusCode).toBe(409);
      expect(complete.json().error.code).toBe('FINANCE_YEAR_CLOSED');
      expect(
        await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receipt.id } }),
      ).toEqual(receipt);
    },
  );

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
      payload: {
        direction: 'INCOME',
        label: '회비',
        amountWon: 100000,
        paidAt: '2026-10-28T12:00:00.000Z',
      },
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
      payload: {
        userId: member.user.id,
        year: group.financeYear.year,
        amountWon: 30000,
        paidAmountWon: 10000,
      },
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

  it('거래 수정·삭제는 재무 권한과 원래 연도 잠금을 검사한다', async () => {
    const owner = await register('수정회장');
    const member = await register('수정회원');
    const group = await createGroup(owner.tokens.accessToken, '수정 모임');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-05-01T03:00:00.000Z');
    const payload = {
      direction: 'EXPENSE',
      label: '식대',
      amountWon: 1000,
      paidAt: '2026-05-01T03:00:00.000Z',
    };
    const create = () =>
      app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
        headers: auth(owner.tokens.accessToken),
        payload,
      });
    const id = (await create()).json().id as string;
    const url = `/api/gathering/groups/${group.id}/transactions/${id}`;
    for (const method of ['PUT', 'DELETE'] as const)
      expect(
        (
          await app.inject({
            method,
            url,
            headers: auth(member.tokens.accessToken),
            ...(method === 'PUT' ? { payload } : {}),
          })
        ).statusCode,
      ).toBe(403);
    const updated = await app.inject({
      method: 'PUT',
      url,
      headers: auth(owner.tokens.accessToken),
      payload: { ...payload, amountWon: 2000, paidAt: '2026-05-02T03:00:00.000Z' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().amountWon).toBe(2000);
    expect(updated.json().paidAt).toBe('2026-05-02T03:00:00.000Z');
    expect(
      (await app.inject({ method: 'DELETE', url, headers: auth(owner.tokens.accessToken) }))
        .statusCode,
    ).toBe(200);
    expect(await prisma.gatheringFinanceTransaction.findUnique({ where: { id } })).toBeNull();
    const lockedId = (await create()).json().id as string;
    await prisma.gatheringFinanceYear.update({
      where: { groupId_year: { groupId: group.id, year: group.financeYear.year } },
      data: { status: 'CLOSED' },
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(member.tokens.accessToken),
    });
    expect(listed.json().items[0].locked).toBe(true);
    for (const method of ['PUT', 'DELETE'] as const) {
      const result = await app.inject({
        method,
        url: `/api/gathering/groups/${group.id}/transactions/${lockedId}`,
        headers: auth(owner.tokens.accessToken),
        ...(method === 'PUT' ? { payload } : {}),
      });
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe('FINANCE_YEAR_CLOSED');
    }
  });

  it('1월 1일 결제는 다음 회계연도이고, 마감된 해는 고칠 수 없다', async () => {
    const owner = await register('경계회장');
    const group = await createGroup(owner.tokens.accessToken, '경계 모임');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-12-31T13:00:00.000Z');
    const missing = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        direction: 'EXPENSE',
        label: '심야 택시',
        amountWon: 18000,
        paidAt: '2026-12-31T15:30:00.000Z',
      },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('FINANCE_YEAR_OUTSIDE_WINDOW');
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
        paidAt: '2026-12-31T15:30:00.000Z',
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
      payload: {
        direction: 'EXPENSE',
        label: '정정',
        amountWon: 1000,
        paidAt: '2026-12-31T15:30:00.000Z',
        adjustment: true,
      },
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
        paidAt: '2026-12-31T15:30:00.000Z',
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
      payload: { startsAt: '2026-12-31T15:00:00.000Z' },
    });
    storage.put(row.storageKey, pdf(32));
    const ready = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/${receiptId}/complete`,
      headers: auth(owner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(ready.statusCode).toBe(200);
    const saved = await prisma.gatheringReceiptAsset.findUniqueOrThrow({
      where: { id: receiptId },
    });
    expect(saved.financeYearId).toBe(reservedYear);
    expect(saved.status).toBe('READY');
  });

  it('기존 12월 24일 시작 기간에 결제를 귀속하고 기간 밖 결제를 거절한다', async () => {
    const owner = await register('기존기간회장');
    const group = await createGroup(owner.tokens.accessToken, '기존 기간 모임');
    const legacy = fiscalYearRange(2026, { startMonth: 12, startDay: 24 });
    const year = await prisma.gatheringFinanceYear.update({
      where: { groupId_year: { groupId: group.id, year: 2026 } },
      data: { startsAt: legacy.startsAt, endsAt: legacy.endsAt },
    });
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-01T03:00:00.000Z');
    const pay = (paidAt: string) => app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: { direction: 'INCOME', label: '참가비', amountWon: 4000, paidAt },
    });
    const inside = await pay(legacy.startsAt.toISOString());
    expect(inside.statusCode).toBe(200);
    expect(inside.json().fiscalYear).toBe(2026);
    const outside = await pay('2026-12-24T00:00:00+09:00');
    expect(outside.statusCode).toBe(409);
    expect(outside.json().error.code).toBe('FINANCE_YEAR_OUTSIDE_WINDOW');
    expect(await prisma.gatheringFinanceTransaction.count({ where: { financeYearId: year.id } })).toBe(1);
  });

  it('빈 해의 시작일 변경도 거절하고, 회비 납부는 행사 수입과 따로 한 번만 합친다', async () => {
    const owner = await register('기간회장');
    const group = await createGroup(owner.tokens.accessToken, '기간 모임');
    const where = { groupId: group.id };
    const before = await prisma.gatheringFinanceYear.findMany({ where });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      startsAt: new Date('2026-01-01T00:00:00+09:00'),
      endsAt: new Date('2026-12-31T23:59:59.999+09:00'),
    });
    const shifted = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 6, fiscalStartDay: 1 },
    });
    expect(shifted.statusCode).toBe(400);
    expect(shifted.json().error.code).toBe('INVALID_PERIOD');
    expect(await prisma.gatheringFinanceYear.findMany({ where })).toEqual(before);
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
      payload: {
        direction: 'INCOME',
        label: '참가비',
        amountWon: 4000,
        paidAt: '2026-03-01T03:00:00.000Z',
      },
    });
    expect(income.statusCode).toBe(200);
    expect(income.json().fiscalYear).toBe(2026);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(listed.json().items[0].fiscalYear).toBe(income.json().fiscalYear);
    const stored = await prisma.gatheringFinanceTransaction.findUniqueOrThrow({
      where: { id: income.json().id as string },
      include: { financeYear: true },
    });
    expect(income.json().fiscalYear).toBe(stored.financeYear.year);
    const locked = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 1, fiscalStartDay: 1 },
    });
    expect(locked.statusCode).toBe(400);
    expect(locked.json().error.code).toBe('INVALID_PERIOD');
    const due = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/finance/dues`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        displayName: '기간회장',
        year: group.financeYear.year,
        amountWon: 10000,
        paidAmountWon: 10000,
        paidAt: '2026-03-02T03:00:00.000Z',
      },
    });
    expect(due.statusCode).toBe(200);
    const summary = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance?year=${income.json().fiscalYear}`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(summary.json().eventIncomeWon).toBe(4000);
    expect(summary.json().duesWon).toBe(10000);
    expect(summary.json().incomeWon).toBe(14000);
    expect(summary.json().events[0].netWon).toBe(4000);
    const rows = await prisma.gatheringFinanceTransaction.count({ where: { groupId: group.id } });
    expect(rows).toBe(1);
    const member = await register('기간회원');
    await join(owner.tokens.accessToken, member.tokens.accessToken, group.id);
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(member.tokens.accessToken),
      payload: { fiscalStartMonth: 7, fiscalStartDay: 1 },
    });
    expect(denied.statusCode).toBe(403);
    const closedView = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance?year=${group.financeYear.year}`,
      headers: auth(member.tokens.accessToken),
    });
    expect(closedView.statusCode).toBe(200);
    expect(closedView.json().eventIncomeWon).toBe(4000);
  });

  it('영수증 상태와 관계없이 기간 변경을 거절하고 저장된 귀속을 유지한다', async () => {
    const owner = await register('영수증기간');
    const group = await createGroup(owner.tokens.accessToken, '영수증 기간');
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-01T03:00:00.000Z');
    const reserve = async () => {
      const uploaded = await app.inject({
        method: 'POST',
        url: `/api/gathering/groups/${group.id}/events/${event.id}/receipts/uploads`,
        headers: auth(owner.tokens.accessToken),
        payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
      });
      expect(uploaded.statusCode).toBe(200);
      return uploaded.json().items[0].id as string;
    };
    const failedId = await reserve();
    await prisma.gatheringReceiptAsset.update({
      where: { id: failedId },
      data: { status: 'FAILED' },
    });
    const pendingId = await reserve();
    const shifted = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${group.id}`,
      headers: auth(owner.tokens.accessToken),
      payload: { fiscalStartMonth: 6, fiscalStartDay: 1 },
    });
    expect(shifted.statusCode).toBe(400);
    const pending = await prisma.gatheringReceiptAsset.findUniqueOrThrow({
      where: { id: pendingId },
      include: { financeYear: true, event: true },
    });
    expect(pending.financeYear.startsAt <= pending.event.startsAt).toBe(true);
    expect(pending.event.startsAt <= pending.financeYear.endsAt).toBe(true);
    expect(pending.financeYear.year).toBe(
      fiscalYearOf(pending.event.startsAt),
    );

    const readyOwner = await register('완료영수증');
    const readyGroup = await createGroup(readyOwner.tokens.accessToken, '완료 영수증');
    const readyEvent = await createEvent(
      readyOwner.tokens.accessToken,
      readyGroup.id,
      '2026-03-01T03:00:00.000Z',
    );
    const readyUpload = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${readyGroup.id}/events/${readyEvent.id}/receipts/uploads`,
      headers: auth(readyOwner.tokens.accessToken),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
    });
    const readyId = readyUpload.json().items[0].id as string;
    const readyRow = await prisma.gatheringReceiptAsset.findUniqueOrThrow({
      where: { id: readyId },
    });
    storage.put(readyRow.storageKey, pdf(32));
    const completed = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${readyGroup.id}/events/${readyEvent.id}/receipts/${readyId}/complete`,
      headers: auth(readyOwner.tokens.accessToken),
      payload: { sizeBytes: 32 },
    });
    expect(completed.statusCode).toBe(200);
    const locked = await app.inject({
      method: 'PATCH',
      url: `/api/gathering/groups/${readyGroup.id}`,
      headers: auth(readyOwner.tokens.accessToken),
      payload: { fiscalStartMonth: 6, fiscalStartDay: 1 },
    });
    expect(locked.statusCode).toBe(400);
    expect(locked.json().error.code).toBe('INVALID_PERIOD');
  });

  it('이미 마감한 해의 잔액은 회비를 합치기 전 스냅샷과 다음 해 기초잔액을 유지한다', async () => {
    const owner = await register('마감잔액');
    const group = await createGroup(owner.tokens.accessToken, '마감 잔액');
    const year = await prisma.gatheringFinanceYear.findFirstOrThrow({
      where: { groupId: group.id, status: 'OPEN' },
    });
    const event = await createEvent(owner.tokens.accessToken, group.id, '2026-03-01T03:00:00.000Z');
    const income = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/events/${event.id}/transactions`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        direction: 'INCOME',
        label: '참가비',
        amountWon: 5000,
        paidAt: '2026-03-01T03:00:00.000Z',
      },
    });
    expect(income.statusCode).toBe(200);
    const due = await app.inject({
      method: 'POST',
      url: `/api/gathering/groups/${group.id}/finance/dues`,
      headers: auth(owner.tokens.accessToken),
      payload: {
        displayName: '마감잔액',
        year: year.year,
        amountWon: 8000,
        paidAmountWon: 8000,
        paidAt: '2026-03-02T03:00:00.000Z',
      },
    });
    expect(due.statusCode).toBe(200);
    const oldBalance = year.openingBalanceWon + 5000;
    await prisma.gatheringFinanceYear.update({
      where: { id: year.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const next = fiscalYearRange(year.year + 1);
    await prisma.gatheringFinanceYear.create({
      data: {
        groupId: group.id,
        year: year.year + 1,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        status: 'OPEN',
        openingBalanceWon: oldBalance,
      },
    });
    await prisma.gatheringFinanceCloseSnapshot.create({
      data: {
        groupId: group.id,
        financeYearId: year.id,
        payloadJson: JSON.stringify({ closingBalanceWon: oldBalance, incomeWon: 5000 }),
        contentHash: `old-close-${year.id}`,
        closedByUserId: owner.user.id,
      },
    });
    const summary = await app.inject({
      method: 'GET',
      url: `/api/gathering/groups/${group.id}/finance?year=${year.year}`,
      headers: auth(owner.tokens.accessToken),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().incomeWon).toBe(5000);
    expect(summary.json().balanceWon).toBe(oldBalance);
    expect(summary.json().duesWon).toBe(8000);
    const carried = await prisma.gatheringFinanceYear.findUniqueOrThrow({
      where: { groupId_year: { groupId: group.id, year: year.year + 1 } },
    });
    expect(carried.openingBalanceWon).toBe(oldBalance);
  });
});

describe('일반 수입·지출', () => {
  it('행사 수입과 회비를 분리해 집계하고 일반 거래와 영수증을 마감에 포함한다', async () => {
    const owner = await register('일반회계회장');
    const treasurer = await register('일반회계재무');
    const member = await register('일반회계회원');
    const token = owner.tokens.accessToken;
    const group = await createGroup(token, '일반 장부 모임');
    const { year } = group.financeYear;
    const url = `/api/gathering/groups/${group.id}`;
    const general = `${url}/finance/general-transactions`;
    const receipts = `${url}/finance/years/${year}/receipts`;
    const paidAt = `${year}-06-01T03:00:00.000Z`;
    const income = { direction: 'INCOME', label: '지원금', amountWon: 2000, paidAt, year };
    const expense = { direction: 'EXPENSE', label: '운영비', amountWon: 1500, paidAt, year };
    const upload = { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] };
    await join(token, treasurer.tokens.accessToken, group.id);
    await join(token, member.tokens.accessToken, group.id);

    const call = async (
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      path: string,
      payload?: object,
      actor = token,
      status = 200,
    ) => {
      const response = await app.inject({ method, url: path, headers: auth(actor), payload });
      expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(status);
      return response.json();
    };
    await call('POST', `${url}/officers`, { userId: treasurer.user.id, role: 'TREASURER' });
    const treasurerToken = treasurer.tokens.accessToken;
    const memberToken = member.tokens.accessToken;
    const event = await createEvent(token, group.id, paidAt);
    const eventPath = `${url}/events/${event.id}/transactions`;
    const eventRow = await call('POST', eventPath, { ...income, amountWon: 4000, label: '행사비' });
    expect(eventRow.eventId).toBe(event.id);
    await call('POST', `${url}/finance/dues`, {
      year, userId: member.user.id, amountWon: 1000, paidAmountWon: 1000, paidAt,
    }, treasurerToken);
    const summaryPath = `${url}/finance?year=${year}`;
    const before = await call('GET', summaryPath);
    expect(before).toMatchObject({ eventIncomeWon: 4000, duesWon: 1000, incomeWon: 5000 });

    expect((await call('POST', general, { ...income, year: year - 1 }, treasurerToken, 400)).error.code)
      .toBe('FINANCE_YEAR_MISMATCH');
    await call('POST', general, income, memberToken, 403);
    const incomeRow = await call('POST', general, income, treasurerToken);
    const expenseRow = await call('POST', general, expense, treasurerToken);
    expect(incomeRow.eventId).toBeNull();
    expect(expenseRow.eventId).toBeNull();

    const incomePath = `${url}/transactions/${incomeRow.id}`;
    await call('PUT', incomePath, income, memberToken, 403);
    await call('DELETE', incomePath, undefined, memberToken, 403);
    const edited = await call('PUT', incomePath, {
      ...income, eventId: event.id, note: '일반 거래 메모',
    }, treasurerToken);
    expect(edited).toMatchObject({ eventId: null, note: '일반 거래 메모' });
    const editedEvent = await call('PUT', `${url}/transactions/${eventRow.id}`, {
      ...income, label: '행사비', amountWon: 4000, eventId: null,
    }, treasurerToken);
    expect(editedEvent.eventId).toBe(event.id);

    const temporary = await call('POST', general, { ...expense, label: '삭제할 거래' }, treasurerToken);
    await call('DELETE', `${url}/transactions/${temporary.id}`, undefined, treasurerToken);
    expect(await prisma.gatheringFinanceTransaction.findUnique({ where: { id: temporary.id } })).toBeNull();
    for (const method of ['GET', 'POST'] as const) {
      await call(method, `${url}/events/missing/transactions`, method === 'POST' ? income : undefined, token, 404);
    }
    expect((await call('GET', eventPath)).items.map((row: { id: string }) => row.id))
      .toEqual([eventRow.id]);

    const expected = {
      eventIncomeWon: 4000, generalIncomeWon: 2000, generalExpenseWon: 1500,
      duesWon: 1000, incomeWon: 7000, expenseWon: 1500, balanceWon: before.openingBalanceWon + 5500,
    };
    const summary = await call('GET', summaryPath, undefined, memberToken);
    expect(summary).toMatchObject(expected);
    expect(summary.events).toEqual([
      { eventId: event.id, title: '정산 행사', incomeWon: 4000, expenseWon: 0, netWon: 4000 },
    ]);
    expect(summary.general).toMatchObject({ incomeWon: 2000, expenseWon: 1500, netWon: 500 });
    expect(summary.general.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: incomeRow.id, eventId: null }),
      expect.objectContaining({ id: expenseRow.id, eventId: null }),
    ]));
    expect(summary.general.items).toHaveLength(2);

    await call('POST', `${receipts}/uploads`, upload, memberToken, 403);
    const reserved = await call('POST', `${receipts}/uploads`, upload, treasurerToken);
    const receiptId = reserved.items[0].id as string;
    const receipt = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id: receiptId } });
    expect(receipt.eventId).toBeNull();
    expect(receipt.storageKey).toContain(`/gatherings/${group.id}/finance/${receipt.financeYearId}/receipts/`);
    expect(receipt.storageKey).not.toContain('/events/');
    const complete = `${receipts}/${receiptId}/complete`;
    await call('POST', `${url}/events/${event.id}/receipts/${receiptId}/complete`, { sizeBytes: 32 }, treasurerToken, 404);
    storage.put(receipt.storageKey, pdf(32));
    await call('POST', complete, { sizeBytes: 32 }, treasurerToken);
    expect((await call('GET', receipts, undefined, memberToken)).items).toMatchObject([{ id: receiptId }]);
    expect((await call('GET', `${url}/events/${event.id}/receipts`)).items).toEqual([]);
    const download = `${url}/receipts/${receiptId}/download`;
    expect((await call('GET', download, undefined, memberToken)).mimeType).toBe('application/pdf');

    const handoverPath = `${url}/handover`;
    const handover = await call('POST', handoverPath, {
      toUserId: member.user.id, idempotencyKey: 'general-finance-close-01',
    });
    const close = `${handoverPath}/${handover.id}`;
    await call('POST', `${close}/accept`, undefined, memberToken);
    const { preview } = await call('GET', handoverPath);
    expect(preview).toMatchObject({ balanceWon: expected.balanceWon, receiptCount: 1 });
    await call('POST', `${close}/confirm`, preview);
    const closed = await call('POST', `${close}/finalize`);
    expect(closed.balanceWon).toBe(expected.balanceWon);
    const snapshot = await prisma.gatheringFinanceCloseSnapshot.findUniqueOrThrow({
      where: { id: closed.snapshotId },
    });
    expect(JSON.parse(snapshot.payloadJson)).toMatchObject({
      closingBalanceWon: expected.balanceWon,
      transactions: expect.arrayContaining([
        expect.objectContaining({ id: eventRow.id, eventId: event.id }),
        expect.objectContaining({ id: incomeRow.id, eventId: null }),
        expect.objectContaining({ id: expenseRow.id, eventId: null }),
      ]),
      receipts: [expect.objectContaining({ id: receiptId, eventId: null })],
    });
    expect(await call('GET', `${url}/finance?year=${year + 1}`)).toMatchObject({
      openingBalanceWon: expected.balanceWon,
    });
    expect(await call('GET', summaryPath)).toMatchObject({ ...expected, status: 'CLOSED' });

    // 마감은 임원 역할을 종료하므로 새 회장이 재무를 다시 임명한다.
    await call('POST', `${url}/officers`, { userId: treasurer.user.id, role: 'TREASURER' }, memberToken);
    const { year: _selectedYear, ...incomeWithoutYear } = income;
    expect((await call('POST', general, incomeWithoutYear, treasurerToken, 409)).error.code)
      .toBe('FINANCE_YEAR_CLOSED');
    const original = await prisma.gatheringFinanceTransaction.findUnique({ where: { id: incomeRow.id } });
    const originalReceipt = await prisma.gatheringReceiptAsset.findUnique({ where: { id: receiptId } });
    for (const [method, path, body] of [
      ['POST', general, income],
      ['PUT', incomePath, { ...income, year: year + 1, paidAt: `${year + 1}-06-01T03:00:00Z` }],
      ['DELETE', incomePath, undefined],
      ['POST', `${receipts}/uploads`, upload],
      ['POST', complete, { sizeBytes: 32 }],
    ] as const) {
      expect((await call(method, path, body, treasurerToken, 409)).error.code).toBe('FINANCE_YEAR_CLOSED');
    }
    await call('DELETE', `${url}/receipts/${receiptId}`, undefined, treasurerToken, 403);
    expect(await prisma.gatheringFinanceTransaction.findUnique({ where: { id: incomeRow.id } })).toEqual(original);
    expect(await prisma.gatheringReceiptAsset.findUnique({ where: { id: receiptId } })).toEqual(originalReceipt);
    await call('GET', download, undefined, memberToken);
  });

  it('이미 예약된 일반 영수증은 연도 마감 후 완료해도 변경되지 않는다', async () => {
    const owner = await register('일반영수증마감');
    const token = owner.tokens.accessToken;
    const group = await createGroup(token, '일반 영수증 마감');
    const path = `/api/gathering/groups/${group.id}/finance/years/${group.financeYear.year}/receipts`;
    const reserved = await app.inject({
      method: 'POST', url: `${path}/uploads`, headers: auth(token),
      payload: { items: [{ mimeType: 'application/pdf', sizeBytes: 32 }] },
    });
    expect(reserved.statusCode).toBe(200);
    const id = reserved.json().items[0].id as string;
    const receipt = await prisma.gatheringReceiptAsset.findUniqueOrThrow({ where: { id } });
    await prisma.gatheringFinanceYear.update({
      where: { id: receipt.financeYearId }, data: { status: 'CLOSED' },
    });
    const complete = await app.inject({
      method: 'POST', url: `${path}/${id}/complete`, headers: auth(token), payload: { sizeBytes: 32 },
    });
    expect(complete.statusCode).toBe(409);
    expect(complete.json().error.code).toBe('FINANCE_YEAR_CLOSED');
    expect(await prisma.gatheringReceiptAsset.findUnique({ where: { id } })).toEqual(receipt);
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
  await prisma.gatheringFinanceCloseSnapshot.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringFinanceYear.deleteMany({ where: { groupId: { in: groupIds } } });
  await prisma.gatheringGroup.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
