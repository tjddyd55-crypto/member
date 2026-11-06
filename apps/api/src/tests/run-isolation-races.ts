import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { buildApp } from '../app.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { disableManagedAdmin } from '../modules/gathering/admin/service.js';
import { openTrialIfUnclaimed } from '../modules/gathering/group-write.js';
import { MemoryObjectStorage } from '../modules/gathering/storage/memory.js';
import { useObjectStorage } from '../modules/gathering/storage/r2.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await superAdminRace();
  const app = await buildApp();
  await app.ready();
  try {
    await quotaRace(app);
    await trialRace(app);
  } finally {
    await app.close();
  }
  await prisma.$disconnect();
  console.log('isolation-races ok');
}

async function superAdminRace() {
  const passwordHash = await bcrypt.hash('IsolationAdmin1!', 4);
  const first = await prisma.gatheringAdminAccount.create({
    data: { loginId: `iso.super.a.${Date.now()}`, passwordHash, role: 'SUPER_ADMIN' },
  });
  const second = await prisma.gatheringAdminAccount.create({
    data: { loginId: `iso.super.b.${Date.now()}`, passwordHash, role: 'SUPER_ADMIN' },
  });
  const results = await Promise.allSettled([
    disableManagedAdmin(first.id, second.id, '동시 비활성'),
    disableManagedAdmin(second.id, first.id, '동시 비활성'),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert(fulfilled.length === 1, `슈퍼관리자 비활성 성공 ${fulfilled.length}건`);
  assert(rejected.length === 1, `슈퍼관리자 비활성 거절 ${rejected.length}건`);
  const reason = rejected[0]?.status === 'rejected' ? rejected[0].reason : null;
  assert(reason instanceof AppError && reason.code === 'LAST_SUPER_ADMIN', '마지막 슈퍼관리자 거절이 아닙니다.');
  const active = await prisma.gatheringAdminAccount.count({
    where: { role: 'SUPER_ADMIN', disabledAt: null },
  });
  assert(active === 1, `남은 슈퍼관리자 ${active}명`);
}

async function quotaRace(app: FastifyInstance) {
  useObjectStorage(new MemoryObjectStorage());
  const owner = await register(app, '용량경쟁');
  const group = await createGroup(app, owner.token);
  const event = await app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${group.id}/events`,
    headers: { authorization: `Bearer ${owner.token}` },
    payload: { title: '용량 행사', startsAt: new Date().toISOString() },
  });
  assert(event.statusCode === 200, `행사 ${event.statusCode}`);
  await prisma.gatheringSubscription.updateMany({
    where: { groupId: group.id, status: 'ACTIVE' },
    data: { storageQuotaBytes: 1000n },
  });
  const [left, right] = await Promise.all([
    reserve(app, owner.token, group.id, event.json().id as string, 800),
    reserve(app, owner.token, group.id, event.json().id as string, 800),
  ]);
  const statuses = [left.statusCode, right.statusCode].sort();
  assert(statuses[0] === 200 && statuses[1] === 409, `예약 결과 ${statuses.join(',')}`);
  const denied = left.statusCode === 409 ? left : right;
  assert(denied.json().error.code === 'QUOTA_EXCEEDED', `거절 코드 ${denied.json().error?.code}`);
  const usage = await prisma.gatheringMediaAsset.aggregate({
    where: { groupId: group.id, deletedAt: null, status: { in: ['PENDING', 'READY'] } },
    _sum: { sizeBytes: true },
  });
  assert(Number(usage._sum.sizeBytes ?? 0n) === 800, `예약 합계 ${usage._sum.sizeBytes}`);
}

async function trialRace(app: FastifyInstance) {
  const owner = await register(app, '체험경쟁');
  const [first, second] = await Promise.all([
    createGroup(app, owner.token, '체험 하나'),
    createGroup(app, owner.token, '체험 둘'),
  ]);
  for (const group of [first, second]) {
    const claims = await prisma.gatheringTrialClaim.count({ where: { groupId: group.id } });
    const trials = await prisma.gatheringSubscription.count({ where: { groupId: group.id, source: 'TRIAL' } });
    assert(claims === 1 && trials === 1, `모임 ${group.id} 체험 ${claims}/${trials}`);
  }
  await prisma.gatheringSubscriptionAudit.deleteMany({ where: { groupId: first.id } });
  await prisma.gatheringSubscription.deleteMany({ where: { groupId: first.id, source: 'TRIAL' } });
  await prisma.gatheringTrialClaim.deleteMany({ where: { groupId: first.id } });
  const raced = await Promise.allSettled([
    prisma.$transaction((tx) => openTrialIfUnclaimed(tx, owner.userId, first.id, new Date())),
    prisma.$transaction((tx) => openTrialIfUnclaimed(tx, owner.userId, first.id, new Date())),
  ]);
  const claims = await prisma.gatheringTrialClaim.count({ where: { groupId: first.id } });
  const trials = await prisma.gatheringSubscription.count({ where: { groupId: first.id, source: 'TRIAL' } });
  assert(claims === 1, `같은 모임 청구 ${claims}`);
  assert(trials === 1, `같은 모임 체험 이용권 ${trials}`);
  const failures = raced.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const reason = failures[0]?.status === 'rejected' ? failures[0].reason : null;
    assert(
      reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === 'P2002',
      '체험 중복은 고유 제약으로만 거절합니다.',
    );
  }
}

function reserve(app: FastifyInstance, token: string, groupId: string, eventId: string, sizeBytes: number) {
  return app.inject({
    method: 'POST',
    url: `/api/gathering/groups/${groupId}/events/${eventId}/media/uploads`,
    headers: { authorization: `Bearer ${token}` },
    payload: { items: [{ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes }] },
  });
}

async function register(app: FastifyInstance, name: string) {
  const phone = `010${Math.floor(10000000 + Math.random() * 89999999)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/auth/register',
    payload: { name, phone, password: 'Passw0rd!', localJcName: '서울테스트', directoryConsent: true },
  });
  assert(res.statusCode === 200, `가입 ${res.statusCode} ${res.body}`);
  return { token: res.json().tokens.accessToken as string, userId: res.json().user.id as string };
}

async function createGroup(app: FastifyInstance, token: string, name = '격리 모임') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gathering/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  assert(res.statusCode === 200, `모임 ${res.statusCode} ${res.body}`);
  return { id: res.json().id as string };
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : '격리 경쟁 실패';
  console.error(message);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
