/**
 * 배포된 모임 API를 실제 HTTP로 한 바퀴 돈다.
 *
 * 필요한 환경변수: API_BASE_URL, GATHERING_OPERATOR_SECRET
 * 정리: --cleanup 과 DATABASE_URL. 비밀은 출력하지 않는다.
 *
 * 예:
 *   API_BASE_URL=http://127.0.0.1:3099 GATHERING_OPERATOR_SECRET=... npm run gathering:e2e -- --cleanup
 */
import { PrismaClient } from '@prisma/client';
import { instantInsideOpenYear } from '../../apps/api/src/modules/gathering/finance/open-year-instant.ts';

const PREFIX = 'e2e-gathering';
const PASSWORD = 'Passw0rd!';

type Json = Record<string, any>;

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

async function main() {
  const base = required('API_BASE_URL').replace(/\/$/, '');
  const operatorSecret = required('GATHERING_OPERATOR_SECRET');
  const cleanup = process.argv.includes('--cleanup');
  try {
    await runFlow(base, operatorSecret);
    console.log('e2e ok');
  } finally {
    if (cleanup) await cleanupRows();
  }
}

async function runFlow(base: string, operatorSecret: string) {
  const owner = await register(base, '회장');
  const next = await register(base, '차기');
  const group = await send(base, '/api/gathering/groups', {
    token: owner.token,
    method: 'POST',
    body: { name: `${PREFIX}-모임`, description: PREFIX },
  });
  createdGroupIds.push(group.id);
  const invite = await send(base, `/api/gathering/groups/${group.id}/invites`, {
    token: owner.token,
    method: 'POST',
    body: { requiresApproval: false },
  });
  await send(base, `/api/gathering/invites/${invite.token}/accept`, {
    token: next.token,
    method: 'POST',
    body: { directoryConsent: true },
  });
  if (!group.financeYear?.startsAt || !group.financeYear?.endsAt) {
    throw new Error('열린 회계연도를 찾지 못했습니다.');
  }
  const startsAt = instantInsideOpenYear(group.financeYear);
  const event = await send(base, `/api/gathering/groups/${group.id}/events`, {
    token: owner.token,
    method: 'POST',
    body: { title: `${PREFIX}-행사`, startsAt },
  });
  await send(base, `/api/gathering/admin/groups/${group.id}/subscription`, {
    token: owner.token,
    method: 'POST',
    headers: { 'x-gathering-operator-secret': operatorSecret },
    body: { source: 'COMPLIMENTARY', idempotencyKey: `${PREFIX}-${group.id}` },
  });
  const photo = jpeg(64);
  const video = mp4(64);
  const receipt = pdf(64);
  await uploadMedia(base, owner.token, group.id, event.id, {
    kind: 'PHOTO',
    mimeType: 'image/jpeg',
    bytes: photo,
  });
  await uploadMedia(base, owner.token, group.id, event.id, {
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    bytes: video,
    durationMs: 5_000,
  });
  await uploadReceipt(base, owner.token, group.id, event.id, receipt);
  const paidAt = startsAt;
  await send(base, `/api/gathering/groups/${group.id}/events/${event.id}/transactions`, {
    token: owner.token,
    method: 'POST',
    body: { direction: 'INCOME', label: `${PREFIX}-회비`, amountWon: 30000, paidAt },
  });
  await send(base, `/api/gathering/groups/${group.id}/events/${event.id}/transactions`, {
    token: owner.token,
    method: 'POST',
    body: { direction: 'EXPENSE', label: `${PREFIX}-식대`, amountWon: 8000, paidAt },
  });
  const handover = await send(base, `/api/gathering/groups/${group.id}/handover`, {
    token: owner.token,
    method: 'POST',
    body: { toUserId: next.userId, idempotencyKey: `${PREFIX}-handover-${group.id}` },
  });
  await send(base, `/api/gathering/groups/${group.id}/handover/${handover.id}/accept`, {
    token: next.token,
    method: 'POST',
    body: {},
  });
  const view = await send(base, `/api/gathering/groups/${group.id}/handover`, { token: owner.token });
  await send(base, `/api/gathering/groups/${group.id}/handover/${handover.id}/confirm`, {
    token: owner.token,
    method: 'POST',
    body: view.preview,
  });
  const closed = await send(base, `/api/gathering/groups/${group.id}/handover/${handover.id}/finalize`, {
    token: owner.token,
    method: 'POST',
    body: {},
  });
  if (!closed.snapshotId) throw new Error('스냅샷이 없습니다.');
  const locked = await send(base, `/api/gathering/groups/${group.id}/events/${event.id}/transactions`, {
    token: next.token,
    method: 'POST',
    body: { direction: 'EXPENSE', label: '마감 후', amountWon: 1000, paidAt },
    expectStatus: 409,
  });
  if (locked.error?.code !== 'FINANCE_YEAR_CLOSED') {
    throw new Error('마감된 해 수정이 막히지 않았습니다.');
  }
}

async function uploadMedia(
  base: string,
  token: string,
  groupId: string,
  eventId: string,
  file: { kind: 'PHOTO' | 'VIDEO'; mimeType: string; bytes: Buffer; durationMs?: number },
) {
  const created = await send(base, `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`, {
    token,
    method: 'POST',
    body: {
      items: [
        {
          kind: file.kind,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
          durationMs: file.durationMs,
          originalName: `${PREFIX}.${file.kind === 'PHOTO' ? 'jpg' : 'mp4'}`,
        },
      ],
    },
  });
  const item = created.items[0];
  await putAndCheck(item, file.bytes);
  await send(base, `/api/gathering/groups/${groupId}/events/${eventId}/media/${item.id}/complete`, {
    token,
    method: 'POST',
    body: { sizeBytes: file.bytes.length },
  });
  const download = await send(base, `/api/gathering/groups/${groupId}/media/${item.id}/download`, { token });
  await readBack(download.url, file.bytes);
}

async function uploadReceipt(base: string, token: string, groupId: string, eventId: string, bytes: Buffer) {
  const created = await send(base, `/api/gathering/groups/${groupId}/events/${eventId}/receipts/uploads`, {
    token,
    method: 'POST',
    body: { items: [{ mimeType: 'application/pdf', sizeBytes: bytes.length, originalName: `${PREFIX}.pdf` }] },
  });
  const item = created.items[0];
  await putAndCheck(item, bytes);
  await send(base, `/api/gathering/groups/${groupId}/events/${eventId}/receipts/${item.id}/complete`, {
    token,
    method: 'POST',
    body: { sizeBytes: bytes.length },
  });
  const download = await send(base, `/api/gathering/groups/${groupId}/receipts/${item.id}/download`, { token });
  await readBack(download.url, bytes);
}

async function putAndCheck(item: { uploadUrl: string; headers: Record<string, string> }, bytes: Buffer) {
  const response = await fetch(item.uploadUrl, { method: 'PUT', headers: item.headers, body: bytes });
  if (!response.ok) throw new Error(`업로드 실패 ${response.status}`);
}

async function readBack(url: string, expected: Buffer) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`다운로드 실패 ${response.status}`);
  const got = Buffer.from(await response.arrayBuffer());
  if (got.length !== expected.length || !got.subarray(0, 8).equals(expected.subarray(0, 8))) {
    throw new Error('다운로드 내용이 올린 파일과 다릅니다.');
  }
}

async function register(base: string, role: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const body = await send(base, '/api/gathering/auth/register', {
    method: 'POST',
    body: {
      name: `${PREFIX}-${role}`,
      phone,
      password: PASSWORD,
      localJcName: '검증로컬',
      directoryConsent: true,
    },
  });
  createdUserIds.push(body.user.id);
  return { token: body.tokens.accessToken as string, userId: body.user.id as string };
}

async function send(
  base: string,
  path: string,
  options: {
    token?: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    expectStatus?: number;
  } = {},
): Promise<Json> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => ({}));
  const expected = options.expectStatus ?? 200;
  if (response.status !== expected) {
    const code = payload?.error?.code ?? 'UNKNOWN';
    console.error(`${options.method ?? 'GET'} ${path} -> ${response.status} ${code}`);
    throw new Error(`${path} ${response.status}`);
  }
  return payload;
}

async function cleanupRows() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL 이 없어 만든 계정을 지우지 못했습니다. 이름 접두어는 e2e-gathering 입니다.');
    return;
  }
  if (createdGroupIds.length === 0 && createdUserIds.length === 0) return;
  const prisma = new PrismaClient();
  try {
    const groupIds = createdGroupIds;
    const userIds = createdUserIds;
    if (groupIds.length > 0) {
      await prisma.gatheringMemberBlock.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringMediaReport.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringMediaAsset.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringReceiptAsset.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringFinanceTransaction.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringMemberDue.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringFinanceCloseSnapshot.deleteMany({ where: { groupId: { in: groupIds } } });
      await prisma.gatheringHandover.deleteMany({ where: { groupId: { in: groupIds } } });
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
    }
    if (userIds.length > 0) {
      await prisma.gatheringNotification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
      await prisma.gatheringPushToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gatheringSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gatheringRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gatheringProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    console.log(`cleanup users=${userIds.length} groups=${groupIds.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} 환경변수가 필요합니다.`);
    process.exit(1);
  }
  return value;
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

function mp4(size: number) {
  const body = Buffer.alloc(size, 0);
  body.write('ftyp', 4, 'ascii');
  body.write('isom', 8, 'ascii');
  return body;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'e2e failed';
  console.error(message);
  process.exit(1);
});
