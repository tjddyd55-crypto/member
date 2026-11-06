import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';

const SCHEMA = 'gathering_iso_races';
const root = resolve(import.meta.dirname, '../../../..');

function isolatedUrl() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.searchParams.set('schema', SCHEMA);
  return url.toString();
}

function redact(text: string) {
  const password = new URL(process.env.DATABASE_URL ?? 'http://localhost').password;
  if (!password) return text;
  return text.split(password).join('[redacted]').split(decodeURIComponent(password)).join('[redacted]');
}

describe('격리된 스키마의 경쟁', () => {
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it('슈퍼관리자 한 명, 용량 예약 하나, 모임 체험 하나만 남긴다', async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    const env = { ...process.env, DATABASE_URL: isolatedUrl(), NODE_ENV: 'test' };
    const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    expect(migrate.status, redact(`${migrate.stdout}\n${migrate.stderr}`)).toBe(0);
    const run = spawnSync('npx', ['tsx', 'apps/api/src/tests/run-isolation-races.ts'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    expect(run.status, redact(`${run.stdout}\n${run.stderr}`)).toBe(0);
    expect(run.stdout).toContain('isolation-races ok');
  }, 180_000);
});
