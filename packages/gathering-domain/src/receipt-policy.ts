export const RECEIPT_MAX_BYTES = 20_000_000;

export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const RECEIPT_SET = new Set<string>(RECEIPT_MIME_TYPES);

export type ReceiptValidation =
  | { ok: true }
  | { ok: false; code: 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' };

export function validateReceiptUpload(input: { mimeType: string; sizeBytes: number }): ReceiptValidation {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > RECEIPT_MAX_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }
  if (!RECEIPT_SET.has(input.mimeType)) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  return { ok: true };
}
