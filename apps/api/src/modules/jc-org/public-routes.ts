import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { SlidingWindowLimiter } from '../gathering/rate-limit.js';
import { confirmedActive, districtRef, orgChoice, searchLocals } from './directory.js';

const prefix = '/api/gathering/jc-orgs';
const limiter = new SlidingWindowLimiter(180, 60 * 1000);
const querySchema = z.object({ q: z.string().trim().max(120).optional() });

export const jcOrgPublicRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request) => limiter.assert(request.ip));

  app.get(`${prefix}/districts`, async () => {
    const districts = await prisma.district.findMany({
      where: confirmedActive,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { locals: { where: confirmedActive } } } },
    });
    return {
      items: districts.map((org) => ({ ...orgChoice(org), localCount: org._count.locals })),
    };
  });

  app.get(`${prefix}/districts/:districtId/locals`, async (request) => {
    const { districtId } = z.object({ districtId: z.string().cuid() }).parse(request.params);
    const { q } = querySchema.parse(request.query);
    return { items: (await searchLocals(prisma, q, districtId)).map(orgChoice) };
  });

  app.get(`${prefix}/search`, async (request) => {
    const { q } = querySchema.parse(request.query);
    const locals = (await searchLocals(prisma, q)).slice(0, 30);
    return {
      items: locals.map((org) => ({ ...orgChoice(org), district: districtRef(org.district) })),
    };
  });
};
