import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { randomToken, sha256 } from './crypto.js';
import { signGatheringAccessToken } from './tokens.js';

export async function issueGatheringSession(
  tx: Prisma.TransactionClient,
  userId: string,
  userAgent?: string,
) {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
  await tx.gatheringSession.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt,
      userAgent,
    },
  });
  return {
    accessToken: signGatheringAccessToken(userId),
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}
