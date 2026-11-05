import { AppError } from '../../lib/errors.js';

type Bucket = number[];

/** 프로세스 메모리 제한이다. 인스턴스가 여러 대면 막지 못한다. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  reset() {
    this.hits.clear();
  }

  assert(key: string, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      throw new AppError(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}

export const gatheringAuthLimiter = new SlidingWindowLimiter(30, 10 * 60 * 1000);
