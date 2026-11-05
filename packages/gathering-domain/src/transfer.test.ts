import { describe, expect, it } from 'vitest';
import { signedUrlStillFresh } from './transfer.js';

describe('서명 URL 유효 시간', () => {
  it('만료가 임박하면 새 주소가 필요하다고 본다', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(signedUrlStillFresh(new Date(now + 20_000).toISOString(), now)).toBe(false);
    expect(signedUrlStillFresh(new Date(now + 60_000).toISOString(), now)).toBe(true);
    expect(signedUrlStillFresh(undefined, now)).toBe(false);
  });
});
