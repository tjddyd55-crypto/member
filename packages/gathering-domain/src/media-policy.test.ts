import { describe, expect, it } from 'vitest';
import {
  PHOTO_MAX_BYTES,
  UPLOAD_INTENT_TTL_MS,
  VIDEO_MAX_DURATION_MS,
  fittedPhotoSize,
  isPendingUploadLive,
  matchesDeclaredType,
  validateMediaUpload,
} from './media-policy.js';
import { canRetryTransfer, summarizeTransfer } from './transfer.js';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('사진·영상 업로드 제한', () => {
  it('사진은 허용 형식과 크기 안에서만 받는다', () => {
    expect(validateMediaUpload({ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: 1000 })).toEqual({
      ok: true,
      folder: 'photos',
    });
    expect(validateMediaUpload({ kind: 'PHOTO', mimeType: 'image/gif', sizeBytes: 1000 }).ok).toBe(false);
    expect(
      validateMediaUpload({ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes: PHOTO_MAX_BYTES + 1 }).ok,
    ).toBe(false);
  });

  it('영상은 5분과 선언된 길이가 있어야 한다', () => {
    expect(
      validateMediaUpload({
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        durationMs: VIDEO_MAX_DURATION_MS,
      }),
    ).toEqual({ ok: true, folder: 'videos' });
    expect(
      validateMediaUpload({
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
        durationMs: VIDEO_MAX_DURATION_MS + 1,
      }),
    ).toEqual({ ok: false, code: 'VIDEO_TOO_LONG' });
    expect(validateMediaUpload({ kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 1000 }).ok).toBe(false);
  });

  it('긴 변만 줄이고, 업로드 예약은 한 시간 안에만 확정할 수 있다', () => {
    expect(fittedPhotoSize(4000, 2000)).toEqual({ width: 2560, height: 1280 });
    expect(fittedPhotoSize(800, 600)).toBeNull();
    const created = new Date('2026-11-05T00:00:00.000Z');
    expect(isPendingUploadLive(created, new Date(created.getTime() + UPLOAD_INTENT_TTL_MS))).toBe(true);
    expect(isPendingUploadLive(created, new Date(created.getTime() + UPLOAD_INTENT_TTL_MS + 1))).toBe(false);
  });

  it('파일 앞부분으로 선언한 형식을 확인한다', () => {
    expect(matchesDeclaredType('image/jpeg', jpeg)).toBe(true);
    expect(matchesDeclaredType('image/png', png)).toBe(true);
    expect(matchesDeclaredType('image/jpeg', png)).toBe(false);
    expect(matchesDeclaredType('application/pdf', jpeg)).toBe(false);
  });
});

describe('업로드 진행', () => {
  it('여러 파일의 진행률을 합치고 실패만 다시 시도한다', () => {
    expect(
      summarizeTransfer([
        { state: 'done', loaded: 10, total: 10 },
        { state: 'failed', loaded: 4, total: 10 },
      ]),
    ).toEqual({ loaded: 14, total: 20, failed: 1, done: false });
    expect(canRetryTransfer('failed')).toBe(true);
    expect(canRetryTransfer('done')).toBe(false);
  });
});
