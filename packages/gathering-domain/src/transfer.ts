export type TransferState = 'queued' | 'uploading' | 'confirming' | 'done' | 'failed';

export type TransferItem = {
  state: TransferState;
  loaded: number;
  total: number;
};

/** 여러 파일의 진행률을 한 숫자로 모은다. 실패한 항목은 재시도 대상이다. */
export function summarizeTransfer(items: readonly TransferItem[]) {
  const total = items.reduce((sum, item) => sum + safeBytes(item.total), 0);
  const loaded = items.reduce((sum, item) => sum + Math.min(safeBytes(item.loaded), safeBytes(item.total)), 0);
  const failed = items.filter((item) => item.state === 'failed').length;
  return {
    loaded,
    total,
    failed,
    done: items.length > 0 && items.every((item) => item.state === 'done'),
  };
}

export function canRetryTransfer(state: TransferState) {
  return state === 'failed';
}

/** 서명 URL이 끝나기 전에 다시 받는다. 긴 영상 줄에서 뒤 파일이 만료되지 않게 한다. */
export function signedUrlStillFresh(expiresAt: string | undefined, now = Date.now(), skewMs = 30_000) {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return false;
  return exp - now > skewMs;
}

function safeBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}
