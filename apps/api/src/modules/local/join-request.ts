import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { currentAffiliation } from '../jc-org/affiliation.js';

const membershipView = { status: true, role: true } as const;

export async function getLocalMe(userId: string) {
  const current = await prisma.gatheringLocalAffiliation.findFirst({
    where: { userId, ...currentAffiliation.where },
    orderBy: currentAffiliation.orderBy,
    select: {
      localJcName: true,
      local: {
        select: {
          id: true,
          name: true,
          district: { select: { name: true } },
          isActive: true,
          serviceEnabled: true,
          memberships: { where: { userId }, select: membershipView },
        },
      },
    },
  });
  if (!current) return { affiliation: null, state: 'NO_AFFILIATION', membership: null };

  const { local, localJcName } = current;
  if (!local) {
    return { affiliation: { localJcName, local: null }, state: 'LOCAL_NOT_LINKED', membership: null };
  }

  const affiliation = { localJcName, local: { id: local.id, name: local.name, districtName: local.district.name } };
  const membership = local.memberships[0] ?? null;
  const state = local.isActive && local.serviceEnabled
    ? membership?.status ?? 'NOT_REQUESTED'
    : 'SERVICE_NOT_ENABLED';
  return { affiliation, state, membership };
}

const pending = { status: 'PENDING', role: 'MEMBER' } as const;
const requestErrors = {
  ACTIVE: [409, 'LOCAL_ALREADY_MEMBER'],
  SUSPENDED: [403, 'LOCAL_SUSPENDED'],
  REJECTED: [409, 'LOCAL_REQUEST_REJECTED'],
} as const;

async function audit(
  tx: Prisma.TransactionClient,
  action: 'LOCAL_JOIN_REQUESTED' | 'LOCAL_JOIN_CANCELED',
  actorUserId: string,
  localId: string,
  targetId: string,
) {
  await tx.auditLog.create({ data: { action, actorUserId, localId, targetId, targetType: 'LocalMembership' } });
}

export async function requestLocalJoin(userId: string, localId: string) {
  return prisma.$transaction(async (tx) => {
    const local = await tx.local.findUnique({
      where: { id: localId, isActive: true, serviceEnabled: true },
      select: { id: true },
    });
    if (!local) {
      throw new AppError(403, 'LOCAL_SERVICE_NOT_ENABLED', '로컬 서비스를 이용할 수 없습니다.');
    }
    const current = await tx.gatheringLocalAffiliation.findFirst({
      where: { userId, ...currentAffiliation.where },
      orderBy: currentAffiliation.orderBy,
      select: { localId: true },
    });
    if (current?.localId !== localId) {
      throw new AppError(403, 'LOCAL_AFFILIATION_MISMATCH', '현재 소속 로컬에만 가입을 요청할 수 있습니다.');
    }

    const where = { userId_localId: { userId, localId } };
    // Re-read after a concurrent insert or status change. Only the writer records an audit entry.
    while (true) {
      const membership = await tx.localMembership.findUnique({ where, select: { id: true, ...membershipView } });
      if (!membership) {
        const [created] = await tx.localMembership.createManyAndReturn({
          data: { userId, localId, ...pending, memberProfileId: null },
          skipDuplicates: true,
          select: { id: true },
        });
        if (!created) continue;
        await audit(tx, 'LOCAL_JOIN_REQUESTED', userId, localId, created.id);
        return { created: true, membership: pending };
      }

      const { id, status, role } = membership;
      if (status === 'PENDING') return { created: false, membership: { status, role } };
      if (status !== 'WITHDRAWN') {
        const [httpStatus, code] = requestErrors[status];
        throw new AppError(httpStatus, code, '로컬 가입을 요청할 수 없습니다.');
      }

      const updated = await tx.localMembership.updateMany({
        where: { id, status: 'WITHDRAWN' },
        data: { ...pending, memberProfileId: null, joinedAt: null, approvedAt: null, approvedByUserId: null },
      });
      if (!updated.count) continue;
      await audit(tx, 'LOCAL_JOIN_REQUESTED', userId, localId, id);
      return { created: false, membership: pending };
    }
  }, { isolationLevel: 'ReadCommitted' });
}

export async function cancelLocalJoin(userId: string, localId: string) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.localMembership.findUnique({
      where: { userId_localId: { userId, localId } },
      select: { id: true, role: true },
    });
    if (!membership) {
      throw new AppError(404, 'LOCAL_REQUEST_NOT_FOUND', '로컬 가입 요청이 없습니다.');
    }
    const status = 'WITHDRAWN';
    const updated = await tx.localMembership.updateMany({
      where: { id: membership.id, status: 'PENDING' },
      data: { status },
    });
    if (!updated.count) {
      throw new AppError(409, 'LOCAL_REQUEST_NOT_PENDING', '대기 중인 가입 요청만 취소할 수 있습니다.');
    }
    await audit(tx, 'LOCAL_JOIN_CANCELED', userId, localId, membership.id);
    return { status, role: membership.role };
  });
}
