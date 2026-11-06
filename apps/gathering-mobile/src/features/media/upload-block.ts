export const MEDIA_RESERVE_LIMIT = 20;

const ACTIVE_HANDOVER = new Set(['NOMINATED', 'ACCEPTED', 'CONFIRMED']);

export function chunkForReserve<T>(items: readonly T[], limit = MEDIA_RESERVE_LIMIT): T[][] {
  if (limit < 1) throw new Error('예약 묶음은 1장 이상이어야 합니다.');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    chunks.push(items.slice(index, index + limit));
  }
  return chunks;
}

export function handoverInProgress(status: string | null | undefined) {
  return status != null && ACTIVE_HANDOVER.has(status);
}

/** 화면 안내. 서버가 같은 조건으로 다시 거절한다. */
export function uploadBlockReason(input: {
  destinationCount?: number;
  destinationChosen?: boolean;
  writesAllowed?: boolean;
}) {
  if (input.writesAllowed === false) {
    return '이용 기간이 끝나거나 모임이 정지되어 새 사진·영상을 올릴 수 없습니다. 이미 올린 자료는 볼 수 있습니다.';
  }
  if (input.destinationCount === 0) {
    return '올릴 행사나 폴더가 없습니다. 행사를 만들거나 폴더를 만든 뒤 올리세요.';
  }
  if (input.destinationChosen === false) {
    return '사진이나 영상을 올릴 행사 또는 폴더를 고르세요.';
  }
  return null;
}
