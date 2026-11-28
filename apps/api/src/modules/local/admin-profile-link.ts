import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { localPermissionGuard } from './access.js';

type LocalParams = { Params: { localId: string } };
type MemberParams = { Params: { localId: string; membershipId: string } };
const querySchema = z.object({ q: z.string().max(50).trim().min(1) }).strict();
const noteSchema = z.string().max(300).trim().min(1);
const linkBody = z.object({
  memberProfileId: z.string().min(1),
  identityVerified: z.literal(true),
  verificationNote: noteSchema,
}).strict();
const unlinkBody = z.object({ reason: noteSchema }).strict();
const latestFirst = { createdAt: 'desc' } as const;

function membershipNotFound() {
  return new AppError(404, 'LOCAL_MEMBERSHIP_NOT_FOUND', '로컬 멤버십이 없습니다.');
}

function profileAlreadyLinked() {
  return new AppError(409, 'LOCAL_PROFILE_ALREADY_LINKED', '이미 연결된 회원 프로필입니다.');
}

async function listCandidates(localId: string, query: string) {
  const contains = query.replace(/[\\%_]/g, '\\$&');
  const profiles = await prisma.memberProfile.findMany({
    where: {
      localId, userId: null, deletedAt: null, status: 'ACTIVE', membership: null,
      OR: [
        { name: { contains, mode: 'insensitive' } },
        { memberNumber: { contains, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, memberNumber: true, phone: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return { items: profiles.map(({ id, name, memberNumber, phone }) => ({
    memberProfileId: id,
    name,
    memberNumber,
    phoneMasked: phone && phone.length > 4 ? `****${phone.slice(-4)}` : null,
  })) };
}

type LinkDecision = { memberProfileId: string; verificationNote: string } | { reason: string };

async function changeLink(localId: string, membershipId: string, actorUserId: string, decision: LinkDecision) {
  return prisma.$transaction(async (tx) => {
    // Both operations lock the membership before the profile, including when the same account is the actor.
    const [membership] = await tx.$queryRaw<Array<{
      userId: string; memberProfileId: string | null; status: string;
    }>>`
      SELECT "userId", "memberProfileId", "status" FROM "LocalMembership"
      WHERE "id" = ${membershipId} AND "localId" = ${localId}
      FOR UPDATE
    `;
    if (!membership) throw membershipNotFound();

    const link = 'memberProfileId' in decision;
    const memberProfileId = link ? decision.memberProfileId : membership.memberProfileId;
    if (!memberProfileId) {
      throw new AppError(409, 'LOCAL_PROFILE_NOT_LINKED', '연결된 회원 프로필이 없습니다.');
    }

    const [profile] = await tx.$queryRaw<Array<{ userId: string | null; updatedAt: Date }>>`
      SELECT "userId", "updatedAt" FROM "MemberProfile"
      WHERE "id" = ${memberProfileId} AND "localId" = ${localId}
        AND (${!link} OR "deletedAt" IS NULL)
      FOR UPDATE
    `;
    if (!profile) {
      throw new AppError(404, 'LOCAL_PROFILE_NOT_FOUND', '로컬 회원 프로필이 없습니다.');
    }

    if (link && membership.status !== 'ACTIVE') {
      throw new AppError(409, 'LOCAL_MEMBER_NOT_ACTIVE', '활성 로컬 회원만 연결할 수 있습니다.');
    }
    if (link && membership.memberProfileId) {
      throw new AppError(409, 'LOCAL_MEMBERSHIP_ALREADY_LINKED', '이미 프로필이 연결된 로컬 멤버십입니다.');
    }
    if (!link && profile.userId !== null && profile.userId !== membership.userId) {
      throw profileAlreadyLinked();
    }

    const changedProfile = await tx.memberProfile.updateMany({
      where: {
        id: memberProfileId, localId,
        ...(link ? { userId: null, deletedAt: null, membership: null } : { userId: profile.userId }),
      },
      data: { userId: link ? membership.userId : null, updatedAt: profile.updatedAt },
    });
    if (!changedProfile.count) throw profileAlreadyLinked();

    await tx.localMembership.update({
      where: { id: membershipId, localId },
      data: { memberProfileId: link ? memberProfileId : null },
    });

    const action = link ? 'LINKED' : 'UNLINKED';
    const verificationNote = link ? decision.verificationNote : decision.reason;
    await recordLink(tx, { localId, membershipId, memberProfileId, actorUserId, action, verificationNote });
    return { membership: { id: membershipId, memberProfileId: link ? memberProfileId : null } };
  }, { isolationLevel: 'ReadCommitted' });
}

async function recordLink(tx: Prisma.TransactionClient, entry: {
  localId: string; membershipId: string; memberProfileId: string; actorUserId: string;
  action: 'LINKED' | 'UNLINKED'; verificationNote: string;
}) {
  const { localId, membershipId, memberProfileId, actorUserId, action, verificationNote } = entry;
  const latest = await tx.localMemberProfileLink.findFirst({
    where: { localId, membershipId }, orderBy: latestFirst, select: { createdAt: true },
  });
  await tx.localMemberProfileLink.create({
    data: {
      localId, membershipId, memberProfileId, action, verificationNote, actedByUserId: actorUserId,
      createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
    },
  });
  await tx.auditLog.create({
    data: {
      localId, actorUserId, action: `LOCAL_PROFILE_${action}`, targetType: 'LocalMembership', targetId: membershipId,
      metaJson: JSON.stringify({ membershipId, memberProfileId, verificationNote }),
    },
  });
}

async function getHistory(localId: string, membershipId: string) {
  const membership = await prisma.localMembership.findUnique({
    where: { id: membershipId, localId },
    select: {
      profileLinks: {
        where: { localId },
        orderBy: latestFirst,
        select: {
          action: true, createdAt: true, verificationNote: true,
          actedByUser: { select: { gatheringProfile: { select: { displayName: true } } } },
        },
      },
    },
  });
  if (!membership) throw membershipNotFound();
  return { items: membership.profileLinks.map(({ actedByUser, ...entry }) => ({
    ...entry,
    actedByDisplayName: actedByUser.gatheringProfile?.displayName ?? null,
  })) };
}

export const localAdminProfileLinkRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: [app.authenticateGathering, localPermissionGuard('members.manage')] };
  const admin = '/api/local/:localId/admin';
  const member = `${admin}/members/:membershipId`;

  app.get<LocalParams>(`${admin}/profile-link-candidates`, manage, (request) =>
    listCandidates(request.localAccess!.localId, querySchema.parse(request.query).q),
  );
  app.post<MemberParams>(`${member}/profile-link`, manage, (request) => {
    const { localId, userId } = request.localAccess!;
    return changeLink(localId, request.params.membershipId, userId, linkBody.parse(request.body));
  });
  app.post<MemberParams>(`${member}/profile-unlink`, manage, (request) => {
    const { localId, userId } = request.localAccess!;
    return changeLink(localId, request.params.membershipId, userId, unlinkBody.parse(request.body));
  });
  app.get<MemberParams>(`${member}/profile-link-history`, manage, (request) =>
    getHistory(request.localAccess!.localId, request.params.membershipId),
  );
};
