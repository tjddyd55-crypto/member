import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { gatheringAuthLimiter } from '../modules/gathering/rate-limit.js';

let app: FastifyInstance;

beforeAll(async () => {
  gatheringAuthLimiter.reset();
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  const seed = await prisma.user.findUnique({ where: { phone: '01000001003' } });
  if (seed) {
    await prisma.gatheringSession.deleteMany({ where: { userId: seed.id } });
    await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: seed.id, groupId: null } });
  }
  await app.close();
  await prisma.$disconnect();
});

describe('회원수첩 로그인과 세션 회귀', () => {
  it('시드 회원은 로컬 멤버십과 함께 로그인하고 리프레시한다', async () => {
    const before = await prisma.localMembership.findFirst({
      where: { user: { phone: '01000001003' }, status: 'ACTIVE' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: '01000001003', password: 'Passw0rd!' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().membership.local.name).toContain('광진');
    expect(login.json().membership.role).toBe(before?.role);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: login.json().tokens.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${refreshed.json().tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().membership.localId).toBe(before?.localId);

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: login.json().tokens.refreshToken },
    });
    expect(again.statusCode).toBe(401);
  });

  it('모임 토큰은 회원수첩 리프레시와 회원 API에 쓸 수 없다', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/register',
      payload: {
        name: '회귀계정',
        phone: `010${Math.floor(10000000 + Math.random() * 89999999)}`,
        password: 'Passw0rd!',
        localJcName: '테스트로컬',
        directoryConsent: true,
      },
    });
    expect(registered.statusCode).toBe(200);
    const userId = registered.json().user.id as string;
    const gatheringAccess = registered.json().tokens.accessToken as string;
    const gatheringRefresh = registered.json().tokens.refreshToken as string;

    const members = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { authorization: `Bearer ${gatheringAccess}` },
    });
    expect(members.statusCode).toBe(401);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: gatheringRefresh },
    });
    expect(refresh.statusCode).toBe(401);

    const bookLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: registered.json().user.phone, password: 'Passw0rd!' },
    });
    expect(bookLogin.statusCode).toBe(403);
    expect(bookLogin.json().error.code).toBe('NO_MEMBERSHIP');
    const localRows = await prisma.localMembership.count({ where: { userId } });
    expect(localRows).toBe(0);

    await prisma.gatheringAuditLog.deleteMany({ where: { actorUserId: userId } });
    await prisma.gatheringSession.deleteMany({ where: { userId } });
    await prisma.gatheringRecoveryCode.deleteMany({ where: { userId } });
    await prisma.gatheringLocalAffiliation.deleteMany({ where: { userId } });
    await prisma.gatheringProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('모임 로그인이 회원수첩 멤버십 역할을 바꾸지 않는다', async () => {
    const before = await prisma.localMembership.findFirstOrThrow({
      where: { user: { phone: '01000001003' }, status: 'ACTIVE' },
    });
    const gathering = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/login',
      payload: { phone: '01000001003', password: 'Passw0rd!' },
    });
    expect(gathering.statusCode).toBe(200);
    const book = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: '01000001003', password: 'Passw0rd!' },
    });
    expect(book.json().tokens.accessToken).toBeTruthy();
    const after = await prisma.localMembership.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.role).toBe(before.role);
    expect(after.localId).toBe(before.localId);
    expect(after.status).toBe(before.status);

    const bookRefreshOnGathering = await app.inject({
      method: 'POST',
      url: '/api/gathering/auth/refresh',
      payload: { refreshToken: book.json().tokens.refreshToken },
    });
    expect(bookRefreshOnGathering.statusCode).toBe(401);
  });
});

describe('모임 마이그레이션은 기존 테이블을 바꾸지 않는다', () => {
  it('foundation 테이블에 ALTER나 DROP이 없다', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../../prisma/migrations/20261105072156_gathering_module/migration.sql'),
      'utf8',
    );
    const legacy = [
      'User',
      'District',
      'Local',
      'LocalMembership',
      'RefreshSession',
      'MemberProfile',
      'Event',
      'AuditLog',
      'FileObject',
    ];
    expect(sql.includes('DROP ')).toBe(false);
    for (const table of legacy) {
      expect(sql.includes(`ALTER TABLE "${table}"`)).toBe(false);
      expect(sql.includes(`DROP TABLE "${table}"`)).toBe(false);
    }
    expect(sql.includes('CREATE TABLE "gathering_groups"')).toBe(true);
    const endsAt = readFileSync(
      resolve(__dirname, '../../../../prisma/migrations/20261105081411_gathering_event_ends_at/migration.sql'),
      'utf8',
    );
    expect(endsAt.includes('ALTER TABLE "gathering_events"')).toBe(true);
    expect(endsAt.includes('ALTER TABLE "User"')).toBe(false);
    expect(endsAt.includes('ALTER TABLE "Event"')).toBe(false);
  });
});
