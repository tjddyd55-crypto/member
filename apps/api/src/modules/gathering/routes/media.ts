import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  gatheringAlbumQuerySchema,
  gatheringMediaCompleteSchema,
  gatheringMediaListQuerySchema,
  gatheringMediaReportSchema,
  gatheringMediaResolveSchema,
  gatheringMediaUploadSchema,
} from '@member/contracts';
import {
  completeMediaUpload,
  createMediaUploads,
  deleteMedia,
  storageSummary,
} from '../media/commands.js';
import { downloadMedia, listAlbums, listEventMedia } from '../media/queries.js';
import { listMediaReports, reportMedia, resolveMediaReport } from '../media/reports.js';
import { requireGatheringUserId } from '../http.js';

const eventParams = z.object({ groupId: z.string().min(1), eventId: z.string().min(1) });
const assetParams = z.object({ groupId: z.string().min(1), assetId: z.string().min(1) });
const eventAssetParams = eventParams.extend({ assetId: z.string().min(1) });
const groupParams = z.object({ groupId: z.string().min(1) });
const reportParams = z.object({ groupId: z.string().min(1), reportId: z.string().min(1) });

export const gatheringMediaRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.post('/api/gathering/groups/:groupId/events/:eventId/media/uploads', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = gatheringMediaUploadSchema.parse(request.body);
    return createMediaUploads(requireGatheringUserId(request), params.groupId, params.eventId, body.items);
  });

  app.post('/api/gathering/groups/:groupId/events/:eventId/media/:assetId/complete', auth, async (request) => {
    const params = eventAssetParams.parse(request.params);
    const body = gatheringMediaCompleteSchema.parse(request.body);
    return completeMediaUpload(
      requireGatheringUserId(request),
      params.groupId,
      params.eventId,
      params.assetId,
      body.sizeBytes,
    );
  });

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

  app.get('/api/gathering/groups/:groupId/albums', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = gatheringAlbumQuerySchema.parse(request.query);
    return listAlbums(requireGatheringUserId(request), params.groupId, query.year);
  });

  app.get('/api/gathering/groups/:groupId/media/:assetId/download', auth, async (request) => {
    const params = assetParams.parse(request.params);
    return downloadMedia(requireGatheringUserId(request), params.groupId, params.assetId);
  });

  app.delete('/api/gathering/groups/:groupId/media/:assetId', auth, async (request) => {
    const params = assetParams.parse(request.params);
    return deleteMedia(requireGatheringUserId(request), params.groupId, params.assetId);
  });

  app.post('/api/gathering/groups/:groupId/media/:assetId/reports', auth, async (request) => {
    const params = assetParams.parse(request.params);
    const body = gatheringMediaReportSchema.parse(request.body);
    return reportMedia(requireGatheringUserId(request), params.groupId, params.assetId, body.reason);
  });

  app.get('/api/gathering/groups/:groupId/media/reports', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return listMediaReports(requireGatheringUserId(request), params.groupId);
  });

  app.post('/api/gathering/groups/:groupId/media/reports/:reportId/resolve', auth, async (request) => {
    const params = reportParams.parse(request.params);
    const body = gatheringMediaResolveSchema.parse(request.body);
    return resolveMediaReport(requireGatheringUserId(request), params.groupId, params.reportId, body.status);
  });

  app.get('/api/gathering/groups/:groupId/storage', auth, async (request) => {
    const params = groupParams.parse(request.params);
    return storageSummary(requireGatheringUserId(request), params.groupId);
  });
};
