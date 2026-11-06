/**
 * 모임 이용권 저장 공간 정책.
 *
 * 한도는 십진 50GB(50_000_000_000 바이트)이고 사진·영상·영수증·기타를 함께 센다.
 * 이용권 행과 만료 시각은 그대로 둔다. 이용 기간이 없거나 끝나도 사진·영상 업로드는 막지 않는다.
 * 한도를 넘으면 미디어와 영수증 모두 거절한다.
 * 갱신은 사용량을 0으로 되돌리지 않는다.
 */
export const STORAGE_QUOTA_BYTES = 50_000_000_000;

export const ANNUAL_GROUP_FEE_WON = 30_000;

export type StorageUsage = {
  mediaBytes: number;
  receiptBytes: number;
  otherBytes: number;
};

export type UploadKind = 'MEDIA' | 'RECEIPT';

export type UploadDecision = { allowed: true } | { allowed: false; reason: 'QUOTA_EXCEEDED' };

export function billableStorageBytes(usage: StorageUsage): number {
  return usage.mediaBytes + usage.receiptBytes + usage.otherBytes;
}

/** 이용권 활성 여부는 받지 않는다. 회원 권한과 50GB 한도만 업로드를 거절한다. */
export function evaluateUpload(input: {
  usage: StorageUsage;
  kind: UploadKind;
  additionalBytes: number;
}): UploadDecision {
  if (!Number.isFinite(input.additionalBytes) || input.additionalBytes < 0) {
    return { allowed: false, reason: 'QUOTA_EXCEEDED' };
  }
  const nextTotal = billableStorageBytes(input.usage) + input.additionalBytes;
  if (nextTotal > STORAGE_QUOTA_BYTES) {
    return { allowed: false, reason: 'QUOTA_EXCEEDED' };
  }
  return { allowed: true };
}

export type DeleteActor = 'UPLOADER' | 'MODERATOR' | 'TREASURER' | 'OTHER';

/**
 * 이용권 만료는 삭제 조건이 아니다. 그래서 이 함수는 만료 여부를 받지 않는다.
 * 마감된 회계연도의 영수증은 누구도 지우거나 덮어쓸 수 없다.
 * 미디어는 회계 마감과 별개로, 올린 사람 또는 회장·총무가 지울 수 있다.
 */
export function canDeleteStoredObject(input: {
  kind: UploadKind;
  financeYearClosed: boolean;
  actor: DeleteActor;
}): boolean {
  if (input.kind === 'RECEIPT') {
    if (input.financeYearClosed) return false;
    return input.actor === 'TREASURER';
  }
  return input.actor === 'UPLOADER' || input.actor === 'MODERATOR';
}
