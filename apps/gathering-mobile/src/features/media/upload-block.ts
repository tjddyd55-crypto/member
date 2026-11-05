const ACTIVE_HANDOVER = new Set(['NOMINATED', 'ACCEPTED', 'CONFIRMED']);

export function handoverInProgress(status: string | null | undefined) {
  return status != null && ACTIVE_HANDOVER.has(status);
}

export function uploadBlockReason(input: {
  handoverStatus?: string | null;
  uploadsAllowed: boolean;
  destinationCount?: number;
  destinationChosen?: boolean;
}) {
  if (handoverInProgress(input.handoverStatus)) {
    return '인계가 진행 중이라 새 사진과 영상을 올릴 수 없습니다. 이미 올린 파일은 볼 수 있습니다.';
  }
  if (!input.uploadsAllowed) {
    return '이용 기간이 아니라 새 사진과 영상을 올릴 수 없습니다. 이미 올린 파일은 볼 수 있습니다.';
  }
  if (input.destinationCount === 0) {
    return '올릴 행사나 폴더가 없습니다. 행사를 만들거나 폴더를 만든 뒤 올리세요.';
  }
  if (input.destinationChosen === false) {
    return '사진이나 영상을 올릴 행사 또는 폴더를 고르세요.';
  }
  return null;
}
