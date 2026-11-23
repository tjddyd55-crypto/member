import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import {
  gatheringAlbumQuerySchema,
  gatheringMediaCompleteSchema,
  gatheringMediaListQuerySchema,
  gatheringMediaReportSchema,
  gatheringMediaResolveSchema,
  gatheringMediaUploadSchema,
} from '@member/contracts';
import {
  createPosterUpload,
  completePosterUpload,
  completeFolderMediaUpload,
  completeMediaUpload,
  resumeFolderMediaUpload,
  createFolderMediaUploads,
  createMediaUploads,
  deleteMedia,
  deleteEventMedia,
  resumeMediaUpload,
  storageSummary,
} from '../media/commands.js';
import {
  createMediaFolder,
  createUploadLink,
  listUploadLinks,
  listPublicMedia,
  downloadPublicMedia,
  publicComplete,
  publicReserve,
  publicResume,
  publicUploadInfo,
  renameMediaFolder,
  deleteMediaFolder,
  setUploadLinkState,
} from '../media/links.js';
import { downloadMedia, listAlbums, listFolderMedia, listEventMedia } from '../media/queries.js';
import { listMediaReports, reportMedia, resolveMediaReport } from '../media/reports.js';
import { requireGatheringUserId } from '../http.js';
import { uploadPage, uploadErrorPage } from '../media/public-upload-page.js';

const publicUploads = '/api/gathering/public/uploads';
const tokenParams = z.object({ token: z.string().min(1) });

const eventParams = z.object({ groupId: z.string().min(1), eventId: z.string().min(1) });
const assetParams = z.object({ groupId: z.string().min(1), assetId: z.string().min(1) });
const eventAssetParams = eventParams.extend({ assetId: z.string().min(1) });
const groupParams = z.object({ groupId: z.string().min(1) });
const reportParams = z.object({ groupId: z.string().min(1), reportId: z.string().min(1) });

export const gatheringMediaRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.post(
    '/api/gathering/groups/:groupId/events/:eventId/media/uploads',
    auth,
    async (request) => {
      const params = eventParams.parse(request.params);
      const body = gatheringMediaUploadSchema.parse(request.body);
      return createMediaUploads(
        requireGatheringUserId(request),
        params.groupId,
        params.eventId,
        body.items,
      );
    },
  );

  app.post(
    '/api/gathering/groups/:groupId/events/:eventId/media/:assetId/resume',
    auth,
    async (request) => {
      const params = eventAssetParams.parse(request.params);
      return resumeMediaUpload(
        requireGatheringUserId(request),
        params.groupId,
        params.eventId,
        params.assetId,
      );
    },
  );

  app.post(
    '/api/gathering/groups/:groupId/events/:eventId/media/:assetId/complete',
    auth,
    async (request) => {
      const params = eventAssetParams.parse(request.params);
      const body = gatheringMediaCompleteSchema.parse(request.body);
      return completeMediaUpload(
        requireGatheringUserId(request),
        params.groupId,
        params.eventId,
        params.assetId,
        body.sizeBytes,
      );
    },
  );

  app.get('/api/gathering/groups/:groupId/events/:eventId/media', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const query = gatheringMediaListQuerySchema.parse(request.query);
    return listEventMedia(
      requireGatheringUserId(request),
      params.groupId,
      params.eventId,
      query.cursor,
      query.limit,
    );
  });

  app.post('/api/gathering/groups/:groupId/events/:eventId/media/delete', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = z
      .object({ assetIds: z.array(z.string().min(1)).min(1).max(100) })
      .parse(request.body);
    return deleteEventMedia(
      requireGatheringUserId(request),
      params.groupId,
      params.eventId,
      body.assetIds,
    );
  });

  app.get('/api/gathering/groups/:groupId/albums', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = gatheringAlbumQuerySchema.parse(request.query);
    return listAlbums(requireGatheringUserId(request), params.groupId, query.year);
  });

  app.get('/api/gathering/groups/:groupId/media/:assetId/download', auth, async (request) => {
    const params = assetParams.parse(request.params);
    return downloadMedia(requireGatheringUserId(request), params.groupId, params.assetId);
  });

  app.post('/api/gathering/groups/:groupId/media/:assetId/poster-upload', auth, async (request) => {
    const params = assetParams.parse(request.params);
    const body = z
      .object({
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024),
      })
      .parse(request.body);
    return createPosterUpload(
      requireGatheringUserId(request),
      params.groupId,
      params.assetId,
      body.sizeBytes,
    );
  });
  app.post(
    '/api/gathering/groups/:groupId/media/:assetId/poster-complete',
    auth,
    async (request) => {
      const params = assetParams.parse(request.params);
      return completePosterUpload(requireGatheringUserId(request), params.groupId, params.assetId);
    },
  );

  app.delete('/api/gathering/groups/:groupId/media/:assetId', auth, async (request) => {
    const params = assetParams.parse(request.params);
    return deleteMedia(requireGatheringUserId(request), params.groupId, params.assetId);
  });

  app.post('/api/gathering/groups/:groupId/media/:assetId/reports', auth, async (request) => {
    const params = assetParams.parse(request.params);
    const body = gatheringMediaReportSchema.parse(request.body);
    return reportMedia(
      requireGatheringUserId(request),
      params.groupId,
      params.assetId,
      body.reason,
    );
  });

  app.get('/api/gathering/groups/:groupId/media/reports', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return listMediaReports(requireGatheringUserId(request), params.groupId);
  });

  app.post(
    '/api/gathering/groups/:groupId/media/reports/:reportId/resolve',
    auth,
    async (request) => {
      const params = reportParams.parse(request.params);
      const body = gatheringMediaResolveSchema.parse(request.body);
      return resolveMediaReport(
        requireGatheringUserId(request),
        params.groupId,
        params.reportId,
        body.status,
      );
    },
  );

  app.get('/api/gathering/groups/:groupId/storage', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return storageSummary(requireGatheringUserId(request), params.groupId);
  });

  app.post('/api/gathering/groups/:groupId/folders', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = z.object({ title: z.string() }).parse(request.body);
    return createMediaFolder(requireGatheringUserId(request), params.groupId, body.title);
  });

  app.post(
    '/api/gathering/groups/:groupId/folders/:folderId/media/uploads',
    auth,
    async (request) => {
      const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
      const body = gatheringMediaUploadSchema.parse(request.body);
      return createFolderMediaUploads(
        requireGatheringUserId(request),
        params.groupId,
        params.folderId,
        body.items,
      );
    },
  );

  app.post(
    '/api/gathering/groups/:groupId/folders/:folderId/media/:assetId/resume',
    auth,
    async (request) => {
      const params = groupParams
        .extend({ folderId: z.string().min(1), assetId: z.string().min(1) })
        .parse(request.params);
      return resumeFolderMediaUpload(
        requireGatheringUserId(request),
        params.groupId,
        params.folderId,
        params.assetId,
      );
    },
  );

  app.post(
    '/api/gathering/groups/:groupId/folders/:folderId/media/:assetId/complete',
    auth,
    async (request) => {
      const params = groupParams
        .extend({ folderId: z.string().min(1), assetId: z.string().min(1) })
        .parse(request.params);
      const body = gatheringMediaCompleteSchema.parse(request.body);
      return completeFolderMediaUpload(
        requireGatheringUserId(request),
        params.groupId,
        params.folderId,
        params.assetId,
        body.sizeBytes,
      );
    },
  );

  app.get('/api/gathering/groups/:groupId/folders/:folderId/media', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
    const query = z.object({ cursor: z.string().optional() }).parse(request.query);
    return listFolderMedia(
      requireGatheringUserId(request),
      params.groupId,
      params.folderId,
      query.cursor,
    );
  });

  app.delete('/api/gathering/groups/:groupId/folders/:folderId', auth, async (request) => {
    const params = z
      .object({ groupId: z.string().min(1), folderId: z.string().min(1) })
      .parse(request.params);
    return deleteMediaFolder(requireGatheringUserId(request), params.groupId, params.folderId);
  });

  app.post('/api/gathering/groups/:groupId/folders/:folderId', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
    const body = z.object({ title: z.string() }).parse(request.body);
    return renameMediaFolder(
      requireGatheringUserId(request),
      params.groupId,
      params.folderId,
      body.title,
    );
  });

  const linkBody = z.object({
    eventId: z.string().min(1).optional(),
    folderId: z.string().min(1).optional(),
  });
  app.post('/api/gathering/groups/:groupId/upload-links', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = linkBody.parse(request.body);
    return createUploadLink(requireGatheringUserId(request), params.groupId, body);
  });

  app.get('/api/gathering/groups/:groupId/upload-links', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = linkBody.parse(request.query);
    return listUploadLinks(requireGatheringUserId(request), params.groupId, query);
  });

  app.post('/api/gathering/groups/:groupId/upload-links/:linkId/:action', auth, async (request) => {
    const params = groupParams
      .extend({ linkId: z.string().min(1), action: z.enum(['revoke', 'pause', 'resume']) })
      .parse(request.params);
    return setUploadLinkState(
      requireGatheringUserId(request),
      params.groupId,
      params.linkId,
      params.action,
    );
  });

  app.get(`${publicUploads}/:token?`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const { token } = z.object({ token: z.string().default('') }).parse(request.params);
    try {
      const info = await publicUploadInfo(token);
      return reply.type('text/html; charset=utf-8').send(uploadPage(info, token));
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        !['LINK_NOT_FOUND', 'LINK_PAUSED', 'LINK_EXPIRED'].includes(error.code)
      )
        throw error;
      return reply
        .code(error.statusCode)
        .type('text/html; charset=utf-8')
        .send(uploadErrorPage(error.message));
    }
  });

  app.get(`${publicUploads}/:token/media`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { token } = tokenParams.parse(request.params);
    const { cursor } = gatheringMediaListQuerySchema.pick({ cursor: true }).parse(request.query);
    return listPublicMedia(token, cursor);
  });

  app.get(`${publicUploads}/:token/media/:assetId`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { token, assetId } = tokenParams
      .extend({ assetId: z.string().min(1) })
      .parse(request.params);
    return downloadPublicMedia(token, assetId);
  });

  app.post('/api/gathering/public/uploads/:token/reserve', async (request) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaUploadSchema.parse(request.body);
    return publicReserve(params.token, body.items);
  });

  app.post(`${publicUploads}/:token/resume`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { token } = tokenParams.parse(request.params);
    const { assetId } = z.object({ assetId: z.string().min(1) }).parse(request.body);
    return publicResume(token, assetId);
  });

  app.post('/api/gathering/public/uploads/:token/complete', async (request) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaCompleteSchema
      .extend({ assetId: z.string().min(1) })
      .parse(request.body);
    return publicComplete(params.token, body.assetId, body.sizeBytes);
  });
};
