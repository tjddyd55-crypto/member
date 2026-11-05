import { AppError } from '../../../lib/errors.js';

export type GatheringObjectKind = 'media' | 'receipt';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 버킷 안의 모임 파일 경로. 실제 업로드 URL은 버킷이 연결된 뒤에만 발급한다. */
export function buildGatheringObjectKey(input: {
  groupId: string;
  kind: GatheringObjectKind;
  objectId: string;
}) {
  if (!ID_PATTERN.test(input.groupId) || !ID_PATTERN.test(input.objectId)) {
    throw new AppError(400, 'INVALID_STORAGE_KEY', '저장 경로를 만들 수 없습니다.');
  }
  return `gathering/${input.groupId}/${input.kind}/${input.objectId}`;
}

export function assertGatheringStorageConfigured() {
  const values = [
    process.env.STORAGE_ENDPOINT,
    process.env.STORAGE_BUCKET,
    process.env.STORAGE_ACCESS_KEY,
    process.env.STORAGE_SECRET_KEY,
  ];
  if (values.some((value) => !value)) {
    throw new AppError(503, 'STORAGE_UNCONFIGURED', '파일 저장소가 설정되지 않았습니다.');
  }
}

export async function createGatheringUploadTarget(input: {
  groupId: string;
  kind: GatheringObjectKind;
  objectId: string;
}) {
  assertGatheringStorageConfigured();
  buildGatheringObjectKey(input);
  throw new AppError(501, 'STORAGE_NOT_IMPLEMENTED', '서명 URL은 버킷을 연결한 뒤 발급합니다.');
}
