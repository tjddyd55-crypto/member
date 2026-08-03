import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireActiveMembership } from '../plugins/auth.js';

export const localRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/local/current',
    { preHandler: [app.authenticate, requireActiveMembership] },
    async (request) => {
      const auth = request.auth!;
      const local = await prisma.local.findFirst({
        where: { id: auth.localId, isActive: true },
      });
      if (!local) {
        throw new AppError(404, 'NOT_FOUND', '로컬을 찾을 수 없습니다.');
      }
      return {
        id: local.id,
        name: local.name,
        englishName: local.englishName,
        slogan: local.slogan,
        primaryColor: local.primaryColor,
        officePhone: local.officePhone,
      };
    },
  );
};
