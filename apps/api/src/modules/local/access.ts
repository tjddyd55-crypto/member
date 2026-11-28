// PHASE 5(P5-01)에서 직책과 분리된 권한 부여 기록 테이블로 교체. 직책을 받았다고 자동 권한 없음.
import type { MembershipRole, MembershipStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type LocalPermissionKey =
  | 'members.approve'
  | 'members.manage'
  | 'positions.manage'
  | 'notices.manage'
  | 'documents.manage'
  | 'sms.manage'
  | 'admin.grant';

type LocalAccess = {
  userId: string;
  localId: string;
  membershipId: string;
  role: MembershipRole;
  memberProfileId: string | null;
};

const membershipErrors = {
  PENDING: 'LOCAL_PENDING',
  REJECTED: 'LOCAL_REJECTED',
  SUSPENDED: 'LOCAL_SUSPENDED',
  WITHDRAWN: 'LOCAL_WITHDRAWN',
} satisfies Record<Exclude<MembershipStatus, 'ACTIVE'>, string>;

function forbidden(code: string) {
  return new AppError(403, code, '로컬에 접근할 수 없습니다.');
}

export async function requireLocalMember(request: FastifyRequest, localId: string): Promise<LocalAccess> {
  const userId = request.gatheringUserId;
  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', '인증이 필요합니다.');
  }

  const membership = await prisma.localMembership.findUnique({
    where: { userId_localId: { userId, localId } },
    select: {
      id: true,
      role: true,
      status: true,
      memberProfileId: true,
      local: { select: { isActive: true, serviceEnabled: true } },
      user: { select: { status: true } },
    },
  });

  if (!membership?.local.isActive) {
    throw forbidden('LOCAL_NOT_MEMBER');
  }
  if (membership.user.status !== 'ACTIVE') {
    throw forbidden('LOCAL_FORBIDDEN');
  }
  if (membership.status !== 'ACTIVE') {
    throw forbidden(membershipErrors[membership.status]);
  }

  if (!membership.local.serviceEnabled) {
    throw forbidden('LOCAL_SERVICE_DISABLED');
  }

  return { userId, localId, membershipId: membership.id, role: membership.role, memberProfileId: membership.memberProfileId };
}

export function requireLocalPermission(access: LocalAccess, key: LocalPermissionKey): void {
  if (access.role === 'LOCAL_OWNER' || (access.role === 'LOCAL_ADMIN' && key !== 'admin.grant')) {
    return;
  }
  throw forbidden('LOCAL_FORBIDDEN');
}

type LocalRequest = FastifyRequest<{ Params: { localId: string } }>;

export async function localMemberGuard(request: LocalRequest): Promise<void> {
  request.localAccess = await requireLocalMember(request, request.params.localId);
}

export function localPermissionGuard(key: LocalPermissionKey) {
  return async (request: LocalRequest): Promise<void> => {
    const access = await requireLocalMember(request, request.params.localId);
    requireLocalPermission(access, key);
    request.localAccess = access;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    localAccess?: LocalAccess | null;
  }
}
