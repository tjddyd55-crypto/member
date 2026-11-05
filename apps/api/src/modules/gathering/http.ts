import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';

export function requireGatheringUserId(request: FastifyRequest) {
  if (!request.gatheringUserId) {
    throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  }
  return request.gatheringUserId;
}

export function readUserAgent(request: FastifyRequest) {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value : undefined;
}

export function limitGatheringAuth(
  request: FastifyRequest,
  limiter: { assert: (key: string) => void },
) {
  limiter.assert(`${request.ip}:gathering-auth`);
}
