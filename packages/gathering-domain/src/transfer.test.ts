import { describe, expect, it } from 'vitest';
import { signedUrlStillFresh, summarizeTransfer } from './transfer.js';

describe('서명 URL 유효 시간', () => {
  it('만료가 임박하면 새 주소가 필요하다고 본다', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(signedUrlStillFresh(new Date(now + 20_000).toISOString(), now)).toBe(false);
    expect(signedUrlStillFresh(new Date(now + 60_000).toISOString(), now)).toBe(true);
    expect(signedUrlStillFresh(undefined, now)).toBe(false);
  });
});

describe('업로드 집계', () => {
  it('바이트 비율을 정수로 반올림하고 완료 개수를 센다', () => {
    expect(
      summarizeTransfer([
        { state: 'done', loaded: 1, total: 1 },
        { state: 'uploading', loaded: 0, total: 2 },
      ]),
    ).toMatchObject({ percent: 33, completed: 1, count: 2, done: false });
  });
  it('전체 크기가 0이면 완료 파일 비율을 사용한다', () => {
    expect(
      summarizeTransfer([
        { state: 'done', loaded: 0, total: 0 },
        { state: 'queued', loaded: 0, total: 0 },
      ]),
    ).toMatchObject({ percent: 50, completed: 1, count: 2 });
    expect(summarizeTransfer([])).toMatchObject({
      percent: 0,
      completed: 0,
      count: 0,
      done: false,
    });
  });
  it('전송과 확인 중에는 99%를 넘지 않고 완료 후에만 100%가 된다', () => {
    for (const state of ['uploading', 'confirming', 'failed'] as const) {
      expect(summarizeTransfer([{ state, loaded: 200, total: 100 }]).percent).toBe(99);
    }
    for (const total of [0, 100]) {
      expect(summarizeTransfer([{ state: 'done', loaded: total, total }])).toMatchObject({
        percent: 100,
        completed: 1,
        count: 1,
        done: true,
      });
    }
  });
  it('음수와 유효하지 않은 바이트는 0으로 제한한다', () => {
    for (const loaded of [-10, NaN, Infinity]) {
      expect(summarizeTransfer([{ state: 'uploading', loaded, total: 100 }]).percent).toBe(0);
    }
    expect(summarizeTransfer([{ state: 'queued', loaded: 5, total: -1 }]).percent).toBe(0);
  });
});
