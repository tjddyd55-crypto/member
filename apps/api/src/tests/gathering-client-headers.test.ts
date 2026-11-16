import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(
  new URL('../../../gathering-mobile/src/api/client.ts', import.meta.url),
  'utf8',
);

// Exercise the mobile source without loading Expo's native modules in Node.
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS });

function loadClient() {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  const exports: Record<string, any> = {};
  const require = (name: string) => {
    if (name === 'expo-constants') return { default: {} };
    if (name === '@member/gathering-domain') return { SharedRefreshGate: class {} };
    if (name === '../storage/secure') {
      return { tokenStorage: { getAccessToken: async () => 'access-token' } };
    }
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function('require', 'exports', 'fetch', compiled)(require, exports, fetch);
  return { api: exports.api, fetch };
}

describe('모바일 요청 Content-Type', () => {
  it('본문 없는 조회와 DELETE에는 Content-Type을 설정하지 않는다', async () => {
    const { api, fetch } = loadClient();
    await api.me();
    await api.deleteFolder('group', 'folder');
    await api.deleteTransaction('group', 'transaction');
    await api.deleteMedia('group', 'media');
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers).not.toHaveProperty('Content-Type');
      expect(init.headers.Authorization).toBe('Bearer access-token');
    }
  });

  it('JSON 본문에는 Content-Type을 유지한다', async () => {
    const { api, fetch } = loadClient();
    await api.createFolder('group', '폴더');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({ title: '폴더' }),
      }),
    );
  });
});
