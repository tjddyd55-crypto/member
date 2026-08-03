import type { FastifyPluginAsync } from 'fastify';
import { memberListQuerySchema } from '@member/contracts';
import { AppError } from '../lib/errors.js';
import { scopedIdWhere } from '../lib/local-scope.js';
import { prisma } from '../lib/prisma.js';
import { requireActiveMembership } from '../plugins/auth.js';
import { applyPrivacy } from '../services/privacy.js';

export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/members',
    { preHandler: [app.authenticate, requireActiveMembership] },
    async (request) => {
      const auth = request.auth!;
      const query = memberListQuerySchema.parse(request.query);
      // query.localId 는 의도적으로 무시한다.

      const limit = query.limit;
      const search = query.q?.trim();

      const rows = await prisma.memberProfile.findMany({
        where: {
          localId: auth.localId,
          deletedAt: null,
          status: 'ACTIVE',
          ...(query.categoryId ? { membershipCategoryId: query.categoryId } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search } },
                  { currentPositionText: { contains: search } },
                  {
                    companies: {
                      some: {
                        localId: auth.localId,
                        companyName: { contains: search },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        include: {
          membershipCategory: true,
          companies: { where: { isPrimary: true, localId: auth.localId }, take: 1 },
          privacySettings: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(query.cursor
          ? {
              skip: 1,
              cursor: { id: query.cursor },
            }
          : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const items = page.map((m) => {
        const privacyMap = Object.fromEntries(
          m.privacySettings.map((p) => [p.fieldKey, p.visibility]),
        );
        const company = m.companies[0];
        const base = {
          id: m.id,
          name: m.name,
          hanjaName: m.hanjaName,
          memberNumber: m.memberNumber,
          currentPositionText: m.currentPositionText,
          categoryName: m.membershipCategory?.name ?? null,
          companyName: company?.companyName ?? null,
          companyPosition: company?.position ?? null,
          phone: m.phone,
          email: m.email,
        };
        return applyPrivacy(base, privacyMap, auth.role, m.userId === auth.userId);
      });

      return {
        items,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      };
    },
  );

  app.get(
    '/api/members/:memberId',
    { preHandler: [app.authenticate, requireActiveMembership] },
    async (request) => {
      const auth = request.auth!;
      const { memberId } = request.params as { memberId: string };

      const member = await prisma.memberProfile.findFirst({
        where: {
          ...scopedIdWhere(auth, memberId),
          deletedAt: null,
        },
        include: {
          membershipCategory: true,
          companies: { where: { isPrimary: true }, take: 1 },
          privacySettings: true,
        },
      });

      if (!member) {
        throw new AppError(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
      }

      const privacyMap = Object.fromEntries(
        member.privacySettings.map((p) => [p.fieldKey, p.visibility]),
      );
      const company = member.companies[0];
      const base = {
        id: member.id,
        name: member.name,
        hanjaName: member.hanjaName,
        memberNumber: member.memberNumber,
        currentPositionText: member.currentPositionText,
        categoryName: member.membershipCategory?.name ?? null,
        companyName: company?.companyName ?? null,
        companyPosition: company?.position ?? null,
        phone: member.phone,
        email: member.email,
        birthDate: member.birthDate?.toISOString() ?? null,
        homeAddress: member.homeAddress,
        spouseName: member.spouseName,
        hobby: member.hobby,
        specialty: member.specialty,
        introduction: member.introduction,
        joinedAt: member.joinedAt?.toISOString() ?? null,
        privacy: privacyMap,
      };

      return applyPrivacy(base, privacyMap, auth.role, member.userId === auth.userId);
    },
  );
};
