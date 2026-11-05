import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export function signGatheringAccessToken(userId: string) {
  return jwt.sign({ sub: userId, typ: 'gathering_access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    audience: 'gathering',
  });
}

export function verifyGatheringAccessToken(token: string) {
  try {
    const raw = jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'gathering' });
    if (typeof raw === 'string' || raw.typ !== 'gathering_access' || !raw.sub) {
      throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
    }
    return { userId: raw.sub };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 액세스 토큰입니다.');
  }
}
