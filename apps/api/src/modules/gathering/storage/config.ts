const PREFIX_ENV = /^[a-z0-9](?:[a-z0-9-]{0,31})$/;

export type StorageConfig = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  prefixEnv: string;
};

/** 버킷, 접두사, 자격 증명이 모두 있어야 설정으로 본다. 값은 저장소에 두지 않는다. */
export function readStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const bucket = first(env.R2_BUCKET, env.STORAGE_BUCKET);
  const endpoint = first(env.R2_ENDPOINT, env.STORAGE_ENDPOINT);
  const accessKeyId = first(env.R2_ACCESS_KEY_ID, env.STORAGE_ACCESS_KEY);
  const secretAccessKey = first(env.R2_SECRET_ACCESS_KEY, env.STORAGE_SECRET_KEY);
  const region = first(env.R2_REGION, env.STORAGE_REGION) || 'auto';
  const prefixEnv = first(env.R2_PREFIX_ENV);
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey || !prefixEnv) return null;
  if (!PREFIX_ENV.test(prefixEnv)) return null;
  return {
    bucket,
    endpoint: endpoint.replace(/\/$/, ''),
    accessKeyId,
    secretAccessKey,
    region,
    prefixEnv,
  };
}

function first(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}
