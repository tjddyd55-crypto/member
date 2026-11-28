import type { LocalMemberClass } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { currentAffiliation } from '../jc-org/affiliation.js';
import { localPermissionGuard } from './access.js';

type LocalParams = { Params: { localId: string } };
type MemberParams = { Params: { localId: string; membershipId: string } };
const memberClassSchema = z.enum(['YB', 'OB']);
const reasonSchema = z.string().max(300).trim().min(1);
const approvalBody = z.object({ memberClass: memberClassSchema, note: z.string().max(300).trim().optional() }).strict();
const reasonBody = z.object({ reason: reasonSchema }).strict();
const changeBody = reasonBody.extend({ memberClass: memberClassSchema });
const latestFirst = { createdAt: 'desc' } as const;

function membershipNotFound() {
  return new AppError(404, 'LOCAL_MEMBERSHIP_NOT_FOUND', '로컬 멤버십이 없습니다.');
}

async function listPendingRequests(localId: string) {
  const memberships = await prisma.localMembership.findMany({
    where: { localId, status: 'PENDING' },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      updatedAt: true,
      local: { select: { name: true } },
      user: {
        select: {
          phone: true,
          gatheringProfile: { select: { displayName: true } },
          gatheringAffiliations: {
            where: { ...currentAffiliation.where, localId },
            orderBy: currentAffiliation.orderBy,
            take: 1,
            select: { localJcName: true },
          },
        },
      },
    },
  });
  return { items: memberships.map(({ id, updatedAt, local, user }) => ({
    membershipId: id,
    requestedAt: updatedAt,
    displayName: user.gatheringProfile?.displayName ?? null,
    phoneMasked: user.phone && user.phone.length > 4 ? `****${user.phone.slice(-4)}` : null,
    affiliationName: user.gatheringAffiliations[0]?.localJcName ?? local.name,
  })) };
}

type JoinDecision =
  | { memberClass: LocalMemberClass; note?: string }
  | { reason: string };

async function decideJoin(localId: string, membershipId: string, actorUserId: string, decision: JoinDecision) {
  return prisma.$transaction(async (tx) => {
    const where = { id: membershipId, localId };
    const membership = await tx.localMembership.findUnique({ where, select: { userId: true } });
    if (!membership) throw membershipNotFound();
    if (membership.userId === actorUserId) {
      throw new AppError(403, 'LOCAL_SELF_REQUEST', '본인의 가입 요청을 처리할 수 없습니다.');
    }

    const now = new Date();
    const approval = 'memberClass' in decision ? decision : null;
    const updated = await tx.localMembership.updateMany({
      where: { ...where, status: 'PENDING' },
      data: approval ? {
        status: 'ACTIVE', role: 'MEMBER', approvedAt: now, joinedAt: now,
        approvedByUserId: actorUserId, memberClass: approval.memberClass,
      } : { status: 'REJECTED' },
    });
    if (!updated.count) {
      throw new AppError(409, 'LOCAL_REQUEST_NOT_PENDING', '대기 중인 가입 요청만 처리할 수 있습니다.');
    }

    if (approval) {
      await tx.localMemberClassChange.create({
        data: {
          membershipId, localId, fromClass: null, toClass: approval.memberClass,
          changedByUserId: actorUserId, reason: approval.note || '가입 승인',
        },
      });
    }
    const status = approval ? 'ACTIVE' : 'REJECTED';
    const meta = 'memberClass' in decision ? { memberClass: decision.memberClass } : { reason: decision.reason };
    await tx.auditLog.create({
      data: {
        action: approval ? 'LOCAL_JOIN_APPROVED' : 'LOCAL_JOIN_REJECTED',
        localId, actorUserId, targetType: 'LocalMembership', targetId: membershipId,
        metaJson: JSON.stringify({ membershipId, ...meta }),
      },
    });
    return { membership: { id: membershipId, status, ...(approval && { role: 'MEMBER', memberClass: approval.memberClass }) } };
  }, { isolationLevel: 'ReadCommitted' });
}

type ClassDecision = { reason: string; memberClass?: LocalMemberClass };

async function changeClass(localId: string, membershipId: string, actorUserId: string, decision: ClassDecision) {
  return prisma.$transaction(async (tx) => {
    // Serialize changes and reverts for the same membership before reading its history.
    const [membership] = await tx.$queryRaw<Array<{ status: string; memberClass: LocalMemberClass | null }>>`
      SELECT "status", "memberClass" FROM "LocalMembership"
      WHERE "id" = ${membershipId} AND "localId" = ${localId}
      FOR UPDATE
    `;
    if (!membership) throw membershipNotFound();
    if (membership.status !== 'ACTIVE') {
      throw new AppError(409, 'LOCAL_MEMBER_NOT_ACTIVE', '활성 로컬 회원의 분류만 변경할 수 있습니다.');
    }

    const latest = await tx.localMemberClassChange.findFirst({
      where: { membershipId, localId }, orderBy: latestFirst,
    });
    let toClass = decision.memberClass;
    let revertsChangeId: string | undefined;
    if (!toClass) {
      if (!latest?.fromClass || latest.revertsChangeId || latest.toClass !== membership.memberClass) {
        throw new AppError(409, 'LOCAL_CLASS_NOT_REVERTIBLE', '되돌릴 수 있는 분류 변경이 없습니다.');
      }
      toClass = latest.fromClass;
      revertsChangeId = latest.id;
    }
    const fromClass = membership.memberClass;
    if (fromClass === toClass) {
      throw new AppError(409, 'LOCAL_CLASS_UNCHANGED', '이미 지정된 회원 분류입니다.');
    }

    await tx.localMembership.update({ where: { id: membershipId }, data: { memberClass: toClass } });
    const change = await tx.localMemberClassChange.create({
      data: {
        membershipId, localId, fromClass, toClass, changedByUserId: actorUserId,
        reason: decision.reason, revertsChangeId,
        createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'LOCAL_MEMBER_CLASS_CHANGED', localId, actorUserId, targetType: 'LocalMembership', targetId: membershipId,
        metaJson: JSON.stringify({ membershipId, changeId: change.id, fromClass, toClass, revertsChangeId }),
      },
    });
    return { membership: { id: membershipId, memberClass: toClass } };
  }, { isolationLevel: 'ReadCommitted' });
}

async function getClassHistory(localId: string, membershipId: string) {
  const membership = await prisma.localMembership.findUnique({
    where: { id: membershipId, localId },
    select: {
      classChanges: {
        where: { localId },
        orderBy: latestFirst,
        select: {
          id: true, createdAt: true, reason: true, fromClass: true, toClass: true, revertsChangeId: true,
          changedByUser: { select: { gatheringProfile: { select: { displayName: true } } } },
        },
      },
    },
  });
  if (!membership) throw membershipNotFound();
  return { items: membership.classChanges.map(({ changedByUser, ...change }) => ({
    ...change, changedByDisplayName: changedByUser?.gatheringProfile?.displayName ?? null,
  })) };
}

export const localAdminMemberRoutes: FastifyPluginAsync = async (app) => {
  const approve = { preHandler: [app.authenticateGathering, localPermissionGuard('members.approve')] };
  const manage = { preHandler: [app.authenticateGathering, localPermissionGuard('members.manage')] };
  const admin = '/api/local/:localId/admin';

  app.get<LocalParams>(`${admin}/join-requests`, approve, (request) =>
    listPendingRequests(request.localAccess!.localId),
  );
  app.post<MemberParams>(`${admin}/join-requests/:membershipId/approve`, approve, (request) => {
    const { localId, userId } = request.localAccess!;
    return decideJoin(localId, request.params.membershipId, userId, approvalBody.parse(request.body));
  });
  app.post<MemberParams>(`${admin}/join-requests/:membershipId/reject`, approve, (request) => {
    const { localId, userId } = request.localAccess!;
    return decideJoin(localId, request.params.membershipId, userId, reasonBody.parse(request.body));
  });
  app.patch<MemberParams>(`${admin}/members/:membershipId/class`, manage, (request) => {
    const { localId, userId } = request.localAccess!;
    return changeClass(localId, request.params.membershipId, userId, changeBody.parse(request.body));
  });
  app.post<MemberParams>(`${admin}/members/:membershipId/class/revert`, manage, (request) => {
    const { localId, userId } = request.localAccess!;
    return changeClass(localId, request.params.membershipId, userId, reasonBody.parse(request.body));
  });
  app.get<MemberParams>(`${admin}/members/:membershipId/class-history`, manage, (request) =>
    getClassHistory(request.localAccess!.localId, request.params.membershipId),
  );
};
