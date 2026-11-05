const MAX_WON = 1_000_000_000;

export type WonParse = { ok: true; value: number } | { ok: false; message: string };

/** 회비·장부는 정수 원만 저장한다. 소수 원과 0원 이하는 거절한다. */
export function parseWon(amount: unknown): WonParse {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    return { ok: false, message: '금액은 정수 원이어야 합니다.' };
  }
  if (amount <= 0 || amount > MAX_WON) {
    return { ok: false, message: '금액은 1원 이상 10억 원 이하이어야 합니다.' };
  }
  return { ok: true, value: amount };
}
