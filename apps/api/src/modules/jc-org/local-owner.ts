import type {
  LocalMemberClass,
  LocalOwnerAssignmentAction,
  MembershipRole,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { jcOrgTransaction, missingOrg } from './write.js';

const membershipId = z.string().cuid();
const memo = z.string().trim().min(1).max(300);
export const appointOwnerBody = z
  .object({
    membershipId,
    memberClass: z.enum(['YB', 'OB']).optional(),
    identityVerified: z.literal(true),
    note: memo,
  })
  .strict();
export const revokeOwnerBody = z.object({ membershipId, reason: memo }).strict();

type Actor = { id: string; loginId: string };
const activeOwner = { status: 'ACTIVE', role: 'LOCAL_OWNER' } as const;
const requestAction = 'LOCAL_JOIN_REQUESTED';

async function readLocal(localId: string, db: Prisma.TransactionClient = prisma) {
  const local = await db.local.findUnique({
    where: { id: localId },
    select: { isActive: true, serviceEnabled: true },
  });
  if (!local) throw missingOrg();
  return local;
}

function maskPhone(phone: string | null) {
  return phone && phone.length > 4 ? `****${phone.slice(-4)}` : null;
}

type Candidate = {
  membershipId: string;
  status: 'PENDING' | 'ACTIVE';
  role: MembershipRole;
  memberClass: LocalMemberClass | null;
  displayName: string | null;
  phone: string | null;
  requestedAt: Date;
};

export async function localOwnerCandidates(localId: string) {
  await readLocal(localId);
  // The request audit also records re-submissions. Membership timestamps change during approval.
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT m."id" AS "membershipId", m."status", m."role", m."memberClass",
           p."displayName", u."phone", request."createdAt" AS "requestedAt"
    FROM "LocalMembership" m
    JOIN "User" u ON u."id" = m."userId"
    LEFT JOIN "gathering_profiles" p ON p."userId" = u."id"
    JOIN LATERAL (
      SELECT a."createdAt" FROM "AuditLog" a
      WHERE a."localId" = m."localId" AND a."targetId" = m."id"
        AND a."actorUserId" = m."userId" AND a."targetType" = 'LocalMembership'
        AND a."action" = ${requestAction}
      ORDER BY a."createdAt" DESC
      LIMIT 1
    ) request ON true
    WHERE m."localId" = ${localId} AND m."status" IN ('PENDING', 'ACTIVE')
    ORDER BY request."createdAt" ASC, m."id" ASC
    LIMIT 50
  `;
  return {
    items: candidates.map(({ phone, ...candidate }) => ({
      ...candidate,
      phoneMasked: maskPhone(phone),
    })),
  };
}

export async function localOwner(localId: string) {
  return prisma.$transaction(
    async (tx) => {
      await readLocal(localId, tx);
      const membership = await tx.localMembership.findFirst({
        where: { localId, ...activeOwner },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          user: { select: { phone: true, gatheringProfile: { select: { displayName: true } } } },
          ownerAssignments: {
            where: { localId, action: 'APPOINTED' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { createdAt: true },
          },
        },
      });
      const history = await tx.localOwnerAssignment.findMany({
        where: { localId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: {
          id: true,
          membershipId: true,
          action: true,
          actorLabel: true,
          note: true,
          createdAt: true,
        },
      });
      const owner = membership && {
        membershipId: membership.id,
        displayName: membership.user.gatheringProfile?.displayName ?? null,
        phoneMasked: maskPhone(membership.user.phone),
        appointedAt: membership.ownerAssignments[0]?.createdAt ?? null,
      };
      return { owner, history };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

function missingMembership() {
  return new AppError(404, 'LOCAL_MEMBERSHIP_NOT_FOUND', '이 로컬의 가입 요청을 찾을 수 없습니다.');
}

function ineligibleMembership() {
  return new AppError(
    409,
    'LOCAL_OWNER_CANDIDATE_INELIGIBLE',
    '대기 중이거나 승인된 가입 요청만 지정할 수 있습니다. 목록을 다시 확인해 주세요.',
  );
}

async function recordAssignment(
  tx: Prisma.TransactionClient,
  actor: Actor,
  localId: string,
  membershipId: string,
  action: LocalOwnerAssignmentAction,
  note: string,
) {
  const attribution = { actorAdminId: actor.id, actorLabel: actor.loginId };
  const createdAt = new Date();
  await tx.localOwnerAssignment.create({
    data: { localId, membershipId, action, note, createdAt, ...attribution },
  });
  await tx.auditLog.create({
    data: {
      localId,
      action: `LOCAL_OWNER_${action}`,
      targetType: 'LocalMembership',
      targetId: membershipId,
      createdAt,
      metaJson: JSON.stringify(attribution),
    },
  });
}

export function appointLocalOwner(
  actor: Actor,
  localId: string,
  input: z.infer<typeof appointOwnerBody>,
) {
  // Share the organization lock with service and status changes. It also serializes
  // appointments for different candidates, while the conditional write guards membership changes.
  return jcOrgTransaction(prisma, async (tx) => {
    const local = await readLocal(localId, tx);
    const where = { id: input.membershipId, localId };
    const membership = await tx.localMembership.findUnique({
      where,
      select: { userId: true, status: true, role: true, memberClass: true, updatedAt: true },
    });
    if (!membership) throw missingMembership();
    const requested = await tx.auditLog.findFirst({
      where: {
        localId,
        targetId: input.membershipId,
        targetType: 'LocalMembership',
        action: requestAction,
        actorUserId: membership.userId,
      },
      select: { id: true },
    });
    if (!requested) throw missingMembership();
    if (!local.isActive)
      throw new AppError(409, 'JC_ORG_INACTIVE', '비활성 로컬에는 관리자를 지정할 수 없습니다.');
    if (!local.serviceEnabled) {
      throw new AppError(409, 'LOCAL_SERVICE_DISABLED', '로컬 서비스를 먼저 켜 주세요.');
    }
    if (
      await tx.localMembership.findFirst({
        where: { localId, ...activeOwner },
        select: { id: true },
      })
    ) {
      throw new AppError(409, 'LOCAL_OWNER_EXISTS', '이미 지정된 로컬 관리자가 있습니다.');
    }

    const { status, role, memberClass } = membership;
    if (status !== 'PENDING' && status !== 'ACTIVE') throw ineligibleMembership();
    const needsClass = status === 'PENDING' || memberClass === null;
    const initialClass = needsClass ? input.memberClass : undefined;
    if (needsClass && !initialClass) {
      throw new AppError(
        400,
        'LOCAL_MEMBER_CLASS_REQUIRED',
        '회원 분류(YB 또는 OB)를 선택해 주세요.',
      );
    }
    const approval = status === 'PENDING' ? new Date() : undefined;
    const updated = await tx.localMembership.updateMany({
      where: { ...where, status, role, memberClass, updatedAt: membership.updatedAt },
      data: {
        role: 'LOCAL_OWNER',
        memberClass: initialClass,
        ...(approval && {
          status: 'ACTIVE',
          approvedAt: approval,
          joinedAt: approval,
          approvedByUserId: null,
        }),
      },
    });
    if (!updated.count) throw ineligibleMembership();
    if (initialClass) {
      await tx.localMemberClassChange.create({
        data: {
          membershipId: input.membershipId,
          localId,
          fromClass: null,
          toClass: initialClass,
          changedByAdminId: actor.id,
          reason: '최초 관리자 지정',
        },
      });
    }
    await recordAssignment(tx, actor, localId, input.membershipId, 'APPOINTED', input.note);
    return { membershipId: input.membershipId, role: 'LOCAL_OWNER' };
  });
}

export function revokeLocalOwner(
  actor: Actor,
  localId: string,
  input: z.infer<typeof revokeOwnerBody>,
) {
  return jcOrgTransaction(prisma, async (tx) => {
    await readLocal(localId, tx);
    const where = { id: input.membershipId, localId };
    const updated = await tx.localMembership.updateMany({
      where: { ...where, role: 'LOCAL_OWNER' },
      data: { role: 'MEMBER' },
    });
    if (!updated.count) {
      if (!(await tx.localMembership.findUnique({ where, select: { id: true } })))
        throw missingMembership();
      throw new AppError(409, 'LOCAL_NOT_OWNER', '이 멤버십은 로컬 관리자 권한이 없습니다.');
    }
    await recordAssignment(tx, actor, localId, input.membershipId, 'REVOKED', input.reason);
    return { membershipId: input.membershipId, role: 'MEMBER' };
  });
}
