import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../modules/gathering/rate-limit.js';
import { AppError } from '../lib/errors.js';

describe('모임 인증 요청 제한', () => {
  it('같은 키로 한도를 넘기면 거절하고, 다른 키는 그대로 허용한다', () => {
    const limiter = new SlidingWindowLimiter(2, 60_000);
    limiter.assert('login');
    limiter.assert('login');
    expect(() => limiter.assert('login')).toThrow(AppError);
    expect(() => limiter.assert('other')).not.toThrow();
  });
});
