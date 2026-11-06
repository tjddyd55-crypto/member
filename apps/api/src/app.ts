import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { localRoutes } from './routes/local.js';
import { memberRoutes } from './routes/members.js';
import { gatheringAdminRoutes } from './modules/gathering/admin/routes.js';
import { gatheringRoutes } from './modules/gathering/routes/index.js';
import { startDevStorageIfEnabled, stopDevStorage } from './modules/gathering/storage/file-sink.js';

export async function buildApp() {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '요청 값이 올바르지 않습니다.',
          details: err.flatten(),
        },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(toErrorBody(err));
    }
    const anyErr = err as { statusCode?: number; code?: string; message?: string };
    if (typeof anyErr.statusCode === 'number' && anyErr.statusCode >= 400 && anyErr.code) {
      return reply.status(anyErr.statusCode).send({
        error: { code: String(anyErr.code), message: anyErr.message ?? '요청 오류' },
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: '서버 오류가 발생했습니다.' },
    });
  });

  await app.register(cors, { origin: true });
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(localRoutes);
  await app.register(memberRoutes);
  await app.register(gatheringRoutes);
  await app.register(gatheringAdminRoutes);
  await startDevStorageIfEnabled();
  app.addHook('onClose', async () => {
    await stopDevStorage();
  });

  app.get('/health', async () => ({ ok: true }));

  return app;
}

export async function start() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}
