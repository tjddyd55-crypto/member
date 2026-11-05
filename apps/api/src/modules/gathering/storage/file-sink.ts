import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/errors.js';
import type { ObjectStorage, SignedTarget } from './port.js';

const MAX_BYTES = 30_000_000;

let sink: FileSinkStorage | null = null;

/** 운영에서는 켜지지 않는다. 로컬 통합 테스트가 R2 없이 서명 URL을 주고받게 한다. */
export function devStorageEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.GATHERING_DEV_STORAGE === '1';
}

export async function startDevStorageIfEnabled() {
  if (!devStorageEnabled()) return;
  if (sink) return;
  const prefix = process.env.R2_PREFIX_ENV?.trim() || 'dev';
  const dir = process.env.GATHERING_DEV_STORAGE_DIR?.trim() || join(tmpdir(), 'gathering-dev-storage');
  const next = new FileSinkStorage(dir, prefix);
  await next.start();
  sink = next;
}

export async function stopDevStorage() {
  const current = sink;
  sink = null;
  if (!current) return;
  await current.stop();
}

export function devObjectStorage(): ObjectStorage {
  if (!sink) {
    throw new AppError(503, 'STORAGE_UNCONFIGURED', '개발용 파일 저장소가 시작되지 않았습니다.');
  }
  return sink;
}

class FileSinkStorage implements ObjectStorage {
  readonly prefixEnv: string;
  private baseUrl = '';
  private server = createServer((request, response) => {
    void this.handle(request, response);
  });

  constructor(
    private readonly dir: string,
    prefixEnv: string,
  ) {
    this.prefixEnv = prefixEnv;
  }

  async start() {
    await mkdir(this.dir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new AppError(503, 'STORAGE_UNCONFIGURED', '개발용 파일 저장소 주소를 만들지 못했습니다.');
    }
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  stop() {
    return new Promise<void>((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async presignPut(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<SignedTarget> {
    return {
      url: this.signedUrl('PUT', input.key, input.expiresInSeconds),
      expiresAt: expiry(input.expiresInSeconds),
      headers: { 'Content-Type': input.contentType },
    };
  }

  async presignGet(input: { key: string; expiresInSeconds: number }): Promise<SignedTarget> {
    return {
      url: this.signedUrl('GET', input.key, input.expiresInSeconds),
      expiresAt: expiry(input.expiresInSeconds),
      headers: {},
    };
  }

  async head(key: string) {
    try {
      const body = await readFile(this.pathFor(key));
      return { sizeBytes: body.length };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, length: number) {
    const body = await readFile(this.pathFor(key));
    return body.subarray(0, length);
  }

  async remove(key: string) {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  private signedUrl(method: 'PUT' | 'GET', key: string, expiresInSeconds: number) {
    const exp = Date.now() + expiresInSeconds * 1000;
    const sig = sign(method, key, exp);
    const query = new URLSearchParams({ key, exp: String(exp), sig });
    return `${this.baseUrl}/object?${query.toString()}`;
  }

  private pathFor(key: string) {
    if (key.includes('..') || key.startsWith('/')) {
      throw new AppError(400, 'INVALID_STORAGE_KEY', '저장 경로를 만들 수 없습니다.');
    }
    return join(this.dir, createHash('sha256').update(key).digest('hex'));
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? '/', this.baseUrl);
      if (url.pathname !== '/object') {
        response.writeHead(404).end();
        return;
      }
      const method = request.method === 'PUT' ? 'PUT' : request.method === 'GET' ? 'GET' : null;
      const key = url.searchParams.get('key') ?? '';
      const exp = Number(url.searchParams.get('exp'));
      const sig = url.searchParams.get('sig') ?? '';
      if (!method || !key || !verify(method, key, exp, sig)) {
        response.writeHead(403).end();
        return;
      }
      if (method === 'GET') {
        const body = await readFile(this.pathFor(key));
        response.writeHead(200).end(body);
        return;
      }
      const body = await readBody(request);
      await writeFile(this.pathFor(key), body);
      response.writeHead(200).end();
    } catch {
      response.writeHead(400).end();
    }
  }
}

function expiry(expiresInSeconds: number) {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function sign(method: string, key: string, exp: number) {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${method}\n${key}\n${exp}`).digest('hex');
}

function verify(method: string, key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(method, key, exp);
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
