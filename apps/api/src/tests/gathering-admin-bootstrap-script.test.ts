import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');

describe('관리자 bootstrap 스크립트', () => {
  it('루트 CommonJS 패키지에서 tsx 로 로드되고, 값이 없으면 계정을 만들지 않는다', () => {
    const env = { ...process.env };
    delete env.GATHERING_ADMIN_BOOTSTRAP_LOGIN;
    delete env.GATHERING_ADMIN_BOOTSTRAP_PASSWORD;
    const result = spawnSync('npx', ['tsx', 'scripts/gathering-admin-bootstrap.ts'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    expect(output).not.toContain('Top-level await');
    expect(output).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(output).toContain('GATHERING_ADMIN_BOOTSTRAP_LOGIN과 GATHERING_ADMIN_BOOTSTRAP_PASSWORD가 필요합니다.');
    expect(result.status).toBe(1);
  });
});
