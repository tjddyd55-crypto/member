import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

let app: FastifyInstance;

async function login(identifier: string, password = 'Passw0rd!') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier, password },
  });
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('auth', () => {
  it('logs in successfully', async () => {
    const res = await login('01000001003');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.membership.local.name).toContain('광진');
  });

  it('rejects wrong password', async () => {
    const res = await login('01000001003', 'WrongPass1!');
    expect(res.statusCode).toBe(401);
  });

  it('blocks pending membership from members API', async () => {
    const loginRes = await login('01000001099');
    expect(loginRes.statusCode).toBe(200);
    const token = loginRes.json().tokens.accessToken as string;
    const res = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string }; code?: string };
    expect(body.error?.code ?? body.code).toBe('MEMBERSHIP_PENDING');
  });
});

describe('local isolation', () => {
  it('lists only current local members', async () => {
    const loginRes = await login('01000001003');
    const token = loginRes.json().tokens.accessToken as string;
    const res = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ name: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.name.includes('GANGNAM'))).toBe(false);
  });

  it('returns 404 for other local member id', async () => {
    const gj = await login('01000001003');
    const gn = await login('01000002003');
    const gjToken = gj.json().tokens.accessToken as string;
    const gnMembers = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { authorization: `Bearer ${gn.json().tokens.accessToken}` },
    });
    const foreignId = gnMembers.json().items[0].id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/api/members/${foreignId}`,
      headers: { authorization: `Bearer ${gjToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('ignores injected localId query', async () => {
    const gj = await login('01000001003');
    const gnLocal = await prisma.local.findUniqueOrThrow({ where: { code: 'GANGNAM' } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/members?localId=${gnLocal.id}`,
      headers: { authorization: `Bearer ${gj.json().tokens.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ name: string }>;
    expect(items.some((i) => i.name.includes('GANGNAM'))).toBe(false);
  });
});

describe('privacy & logout', () => {
  it('hides private phone on list', async () => {
    const resLogin = await login('01000001004');
    const res = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { authorization: `Bearer ${resLogin.json().tokens.accessToken}` },
    });
    const privateMember = (res.json().items as Array<{ name: string; phone: string | null }>).find(
      (i) => i.name.includes('GWANGJIN3'),
    );
    expect(privateMember).toBeTruthy();
    expect(privateMember?.phone).toBeNull();
  });

  it('revokes refresh after logout', async () => {
    const loginRes = await login('01000001003');
    const refreshToken = loginRes.json().tokens.refreshToken as string;
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);
  });
});
