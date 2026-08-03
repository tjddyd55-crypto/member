import type { MembershipRole, MembershipStatus } from '@prisma/client';

export type AuthContext = {
  userId: string;
  membershipId: string;
  localId: string;
  role: MembershipRole;
  membershipStatus: MembershipStatus;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** localId 스코프 헬퍼 — 클라이언트 localId를 절대 신뢰하지 않는다 */
export function localWhere(auth: AuthContext) {
  return { localId: auth.localId };
}

export function scopedIdWhere(auth: AuthContext, id: string) {
  return { id, localId: auth.localId };
}
