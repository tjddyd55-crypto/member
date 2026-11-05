export const PHOTO_MAX_BYTES = 15_000_000;
export const VIDEO_MAX_BYTES = 200_000_000;
export const VIDEO_MAX_DURATION_MS = 5 * 60 * 1000;
export const PHOTO_MAX_EDGE_PX = 2560;
export const PHOTO_JPEG_QUALITY = 0.82;
export const UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;
export const SIGNED_URL_TTL_SECONDS = 10 * 60;
export const MEDIA_PAGE_LIMIT = 30;

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

export type MediaKind = 'PHOTO' | 'VIDEO';
export type MediaFolder = 'photos' | 'videos';

export type MediaRejectionCode =
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'VIDEO_TOO_LONG'
  | 'DURATION_REQUIRED';

export type MediaValidation =
  | { ok: true; folder: MediaFolder }
  | { ok: false; code: MediaRejectionCode };

const PHOTO_SET = new Set<string>(PHOTO_MIME_TYPES);
const VIDEO_SET = new Set<string>(VIDEO_MIME_TYPES);

export function validateMediaUpload(input: {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
}): MediaValidation {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }
  if (input.kind === 'PHOTO') return validatePhoto(input.mimeType, input.sizeBytes);
  return validateVideo(input.mimeType, input.sizeBytes, input.durationMs);
}

function validatePhoto(mimeType: string, sizeBytes: number): MediaValidation {
  if (!PHOTO_SET.has(mimeType)) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  if (sizeBytes > PHOTO_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
  return { ok: true, folder: 'photos' };
}

function validateVideo(mimeType: string, sizeBytes: number, durationMs?: number | null): MediaValidation {
  if (!VIDEO_SET.has(mimeType)) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  if (sizeBytes > VIDEO_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
  if (durationMs == null) return { ok: false, code: 'DURATION_REQUIRED' };
  if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > VIDEO_MAX_DURATION_MS) {
    return { ok: false, code: 'VIDEO_TOO_LONG' };
  }
  return { ok: true, folder: 'videos' };
}

/** 긴 변이 상한을 넘으면 줄인 크기를 돌려준다. 넘지 않으면 null 이다. */
export function fittedPhotoSize(width: number, height: number, maxEdge = PHOTO_MAX_EDGE_PX) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isPendingUploadLive(createdAt: Date, now: Date) {
  return now.getTime() - createdAt.getTime() <= UPLOAD_INTENT_TTL_MS;
}

const FTYP_BRANDS: Record<string, readonly string[]> = {
  'image/heic': ['heic', 'heix', 'heif', 'mif1', 'msf1'],
  'image/heif': ['heic', 'heix', 'heif', 'mif1', 'msf1'],
  'video/mp4': ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '],
  'video/quicktime': ['qt  ', 'isom', 'mp42'],
};

/** 선언한 형식과 파일 앞부분이 맞는지 본다. 영상 길이는 디코드하지 않는다. */
export function matchesDeclaredType(mimeType: string, header: Uint8Array) {
  if (header.length < 12) return false;
  if (mimeType === 'image/jpeg') return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mimeType === 'image/png') return ascii(header, 0, 8) === '\u0089PNG\r\n\u001a\n';
  if (mimeType === 'image/webp') return ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 12) === 'WEBP';
  if (mimeType === 'application/pdf') return ascii(header, 0, 5) === '%PDF-';
  const brands = FTYP_BRANDS[mimeType];
  if (!brands) return false;
  return ascii(header, 4, 8) === 'ftyp' && brands.includes(ascii(header, 8, 12));
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
