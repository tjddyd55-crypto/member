import { createHash, randomBytes } from 'node:crypto';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function createRecoveryCode() {
  const bytes = randomBytes(8);
  let raw = '';
  for (const byte of bytes) {
    raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeRecoveryCode(input: string) {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function inviteLink(token: string) {
  return `jcikorea://invite/${token}`;
}
