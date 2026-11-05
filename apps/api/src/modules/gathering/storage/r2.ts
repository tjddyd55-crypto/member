import { buildGatheringObjectKey as buildKey, buildMemberBookProfileKey as buildProfileKey } from '@member/gathering-domain';
import type { GatheringObjectFolder } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { readStorageConfig } from './config.js';
import { MemoryObjectStorage } from './memory.js';
import type { ObjectStorage } from './port.js';
import { R2ObjectStorage } from './s3-sigv4.js';

export { buildMemberBookProfileKey } from '@member/gathering-domain';

let override: ObjectStorage | undefined;
let forceUnconfigured = false;

export function useObjectStorage(storage: ObjectStorage | 'unconfigured' | 'default') {
  if (storage === 'default') {
    override = undefined;
    forceUnconfigured = false;
    return;
  }
  if (storage === 'unconfigured') {
    override = undefined;
    forceUnconfigured = true;
    return;
  }
  override = storage;
  forceUnconfigured = false;
}

export function buildGatheringObjectKey(input: {
  prefixEnv: string;
  groupId: string;
  eventId: string;
  folder: GatheringObjectFolder;
  objectId: string;
}) {
  try {
    return buildKey(input);
  } catch {
    throw new AppError(400, 'INVALID_STORAGE_KEY', '저장 경로를 만들 수 없습니다.');
  }
}

export function buildProfileObjectKey(input: { prefixEnv: string; userId: string; objectId: string }) {
  try {
    return buildProfileKey(input);
  } catch {
    throw new AppError(400, 'INVALID_STORAGE_KEY', '저장 경로를 만들 수 없습니다.');
  }
}

export function assertGatheringStorageConfigured() {
  if (forceUnconfigured || !readStorageConfig()) {
    throw new AppError(503, 'STORAGE_UNCONFIGURED', '파일 저장소가 설정되지 않았습니다.');
  }
}

export function currentObjectStorage(): ObjectStorage {
  if (override) return override;
  if (forceUnconfigured) {
    throw new AppError(503, 'STORAGE_UNCONFIGURED', '파일 저장소가 설정되지 않았습니다.');
  }
  const config = readStorageConfig();
  if (!config) {
    throw new AppError(503, 'STORAGE_UNCONFIGURED', '파일 저장소가 설정되지 않았습니다.');
  }
  return new R2ObjectStorage(config);
}

export function storageForTests() {
  return new MemoryObjectStorage();
}
