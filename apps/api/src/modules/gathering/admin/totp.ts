import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../lib/errors.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// 로그인은 이 파일을 부르지 않는다. 이미 저장된 암호문과 키는 지우지 않는다.

function totpKey() {
  const raw =
    process.env.GATHERING_ADMIN_TOTP_KEY ||
    (process.env.NODE_ENV === 'test' ? 'test-admin-totp-key-not-for-prod-32' : '');
  if (raw.length < 16) {
    throw new AppError(503, 'ADMIN_NOT_CONFIGURED', '관리자 인증 설정이 없습니다.');
  }
  return createHash('sha256').update(raw).digest();
}

export function encryptAdminSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', totpKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64');
}

export function decryptAdminSecret(payload: string) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', totpKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, timeMs: number) {
  const counter = Math.floor(timeMs / 30_000);
  return hotp(base32Decode(secret), counter);
}

export function totpMatches(secret: string, code: string, timeMs: number) {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const step = Math.floor(timeMs / 30_000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = hotp(base32Decode(secret), step + offset);
    if (safeCodeEqual(normalized, expected)) return true;
  }
  return false;
}

export function otpauthUrl(loginId: string, secret: string) {
  const label = encodeURIComponent(`JCI KOREA:${loginId}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('JCI KOREA')}&digits=6&period=30`;
}

function hotp(secret: Buffer, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string) {
  const clean = input.replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new AppError(400, 'TOTP_INVALID', '인증 코드가 올바르지 않습니다.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function safeCodeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
