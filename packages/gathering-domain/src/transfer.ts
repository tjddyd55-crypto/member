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

function safeBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}
