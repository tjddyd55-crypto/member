import { AppError } from '../../../lib/errors.js';
import type { ObjectStorage, SignedTarget } from './port.js';

/** 테스트와 로컬 대역. 네트워크와 실제 버킷을 부르지 않는다. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly prefixEnv = 'test';
  readonly objects = new Map<string, Buffer>();

  put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }

  async presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<SignedTarget> {
    return this.sign('put', input.key, input.expiresInSeconds, {
      'Content-Type': input.contentType,
      'Content-Length': String(input.sizeBytes),
    });
  }

  async presignGet(input: { key: string; expiresInSeconds: number }): Promise<SignedTarget> {
    return this.sign('get', input.key, input.expiresInSeconds, {});
  }

  async head(key: string) {
    const body = this.objects.get(key);
    if (!body) return null;
    return { sizeBytes: body.length };
  }

  async readPrefix(key: string, length: number) {
    const body = this.objects.get(key);
    if (!body) throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
    return body.subarray(0, length);
  }

  async remove(key: string) {
    this.objects.delete(key);
  }

  async relocate(fromKey: string, toKey: string) {
    const body = this.objects.get(fromKey);
    if (!body) throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
    this.objects.set(toKey, Buffer.from(body));
    this.objects.delete(fromKey);
  }

  private sign(action: 'put' | 'get', key: string, expiresInSeconds: number, headers: Record<string, string>) {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return {
      url: `https://storage.test/${action}/${encodeURIComponent(key)}`,
      expiresAt,
      headers,
    };
  }
}
