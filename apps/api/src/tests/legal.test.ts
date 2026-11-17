import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { businessInfo, privacyPolicy, termsPolicy } from '@member/contracts';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';

let app: FastifyInstance;
const previous = env.NODE_ENV;
beforeAll(async () => {
  env.NODE_ENV = 'production';
  app = await buildApp();
});
afterAll(async () => {
  await app?.close();
  env.NODE_ENV = previous;
});

describe('public legal pages in production (no authentication or DB queries)', () => {
  for (const [path, policy] of [
    ['privacy', privacyPolicy],
    ['terms', termsPolicy],
  ] as const) {
    it(`serves shared Korean ${path} content`, async () => {
      const response = await app.inject({ method: 'GET', url: `/legal/${path}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html; charset=utf-8');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.body).toContain('lang="ko"');
      expect(response.body).toContain('name="viewport"');
      expect(response.body).toContain(policy.title);
      for (const paragraph of policy.paragraphs) expect(response.body).toContain(paragraph);
    });
  }
  it('explains account deletion, retained data, retention limits and operator contact', async () => {
    const response = await app.inject('/legal/account-deletion');
    expect(response.statusCode).toBe(200);
    for (const text of [
      '계정 삭제 → 장부 보존에 동의 → 비밀번호 입력 → 삭제',
      '회원수첩',
      '자동 삭제 기한이 정해져 있지 않습니다',
      '내부 사용자 식별자',
      businessInfo.businessEmail,
    ]) {
      expect(response.body).toContain(text);
    }
  });
});
