import { createHash, createHmac } from 'node:crypto';
import { AppError } from '../../../lib/errors.js';
import type { StorageConfig } from './config.js';
import type { ObjectStorage, SignedTarget } from './port.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED = 'UNSIGNED-PAYLOAD';

export class R2ObjectStorage implements ObjectStorage {
  readonly prefixEnv: string;

  constructor(private readonly config: StorageConfig) {
    this.prefixEnv = config.prefixEnv;
  }

  async presignPut(input: { key: string; contentType: string; sizeBytes: number; expiresInSeconds: number }) {
    return this.presign('PUT', input.key, input.expiresInSeconds, {
      'content-type': input.contentType,
      'content-length': String(input.sizeBytes),
    });
  }

  async presignGet(input: { key: string; expiresInSeconds: number }) {
    return this.presign('GET', input.key, input.expiresInSeconds, {});
  }

  async head(key: string) {
    const response = await this.signedFetch('HEAD', key);
    if (response.status === 404) return null;
    if (!response.ok) throw storageFailure();
    const size = Number(response.headers.get('content-length'));
    if (!Number.isInteger(size) || size < 0) throw storageFailure();
    return { sizeBytes: size };
  }

  async readPrefix(key: string, length: number) {
    const response = await this.signedFetch('GET', key, { range: `bytes=0-${length - 1}` });
    if (response.status === 404) {
      throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
    }
    if (!response.ok) throw storageFailure();
    return new Uint8Array(await response.arrayBuffer());
  }

  async remove(key: string) {
    const response = await this.signedFetch('DELETE', key);
    if (response.status === 404 || response.ok) return;
    throw storageFailure();
  }

  async relocate(fromKey: string, toKey: string) {
    const source = await this.signedFetch('GET', fromKey);
    if (source.status === 404) {
      throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
    }
    if (!source.ok) throw storageFailure();
    const body = Buffer.from(await source.arrayBuffer());
    const saved = await this.signedFetch('PUT', toKey, {}, body);
    if (!saved.ok) throw storageFailure();
    await this.remove(fromKey);
  }

  private presign(
    method: 'PUT' | 'GET',
    key: string,
    expiresInSeconds: number,
    extraHeaders: Record<string, string>,
  ): SignedTarget {
    const now = new Date();
    const { host, canonicalUri } = this.location(key);
    const amzDate = stamp(now);
    const scope = credentialScope(amzDate.slice(0, 8), this.config.region);
    const headers = { host, ...extraHeaders };
    const signedHeaderNames = Object.keys(headers).sort();
    const query = canonicalQuery({
      'X-Amz-Algorithm': ALGORITHM,
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaderNames.join(';'),
    });
    const canonical = [
      method,
      canonicalUri,
      query,
      canonicalHeaders(headers),
      signedHeaderNames.join(';'),
      UNSIGNED,
    ].join('\n');
    const signature = sign(this.config.secretAccessKey, amzDate, this.config.region, canonical);
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
    const clientHeaders: Record<string, string> = {};
    if (extraHeaders['content-type']) clientHeaders['Content-Type'] = extraHeaders['content-type'];
    if (extraHeaders['content-length']) clientHeaders['Content-Length'] = extraHeaders['content-length'];
    return {
      url: `${this.config.endpoint}${canonicalUri}?${query}&X-Amz-Signature=${signature}`,
      expiresAt,
      headers: clientHeaders,
    };
  }

  private async signedFetch(
    method: 'HEAD' | 'GET' | 'DELETE' | 'PUT',
    key: string,
    extraHeaders: Record<string, string> = {},
    body?: Buffer,
  ) {
    const now = new Date();
    const { host, canonicalUri } = this.location(key);
    const amzDate = stamp(now);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': UNSIGNED,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonical = [
      method,
      canonicalUri,
      '',
      canonicalHeaders(headers),
      signedHeaderNames.join(';'),
      UNSIGNED,
    ].join('\n');
    const signature = sign(this.config.secretAccessKey, amzDate, this.config.region, canonical);
    const scope = credentialScope(amzDate.slice(0, 8), this.config.region);
    const authorization = `${ALGORITHM} Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`;
    const { host: _host, ...signed } = headers;
    return fetch(`${this.config.endpoint}${canonicalUri}`, {
      method,
      headers: { ...signed, authorization },
      body: body ? new Uint8Array(body) : undefined,
    });
  }

  private location(key: string) {
    const endpoint = new URL(this.config.endpoint);
    const canonicalUri = `/${encodePath(this.config.bucket)}/${encodePath(key)}`;
    return { host: endpoint.host, canonicalUri };
  }
}

function storageFailure() {
  return new AppError(501, 'STORAGE_NOT_IMPLEMENTED', '저장소 서명을 완료하지 못했습니다.');
}

function stamp(now: Date) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function credentialScope(date: string, region: string) {
  return `${date}/${region}/s3/aws4_request`;
}

function canonicalHeaders(headers: Record<string, string>) {
  return (
    Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name]?.trim()}`)
      .join('\n') + '\n'
  );
}

function canonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((name) => `${encodeQuery(name)}=${encodeQuery(params[name] ?? '')}`)
    .join('&');
}

function encodePath(value: string) {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function encodeQuery(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sign(secret: string, amzDate: string, region: string, canonical: string) {
  const date = amzDate.slice(0, 8);
  const hashed = createHash('sha256').update(canonical).digest('hex');
  const stringToSign = [ALGORITHM, amzDate, credentialScope(date, region), hashed].join('\n');
  let key: Buffer = Buffer.from(`AWS4${secret}`);
  for (const part of [date, region, 's3', 'aws4_request']) {
    key = createHmac('sha256', key).update(part).digest();
  }
  return createHmac('sha256', key).update(stringToSign).digest('hex');
}
