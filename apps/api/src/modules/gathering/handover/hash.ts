import { createHash } from 'node:crypto';
import { canonicalJson } from '@member/gathering-domain';

export function sha256Canonical(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
