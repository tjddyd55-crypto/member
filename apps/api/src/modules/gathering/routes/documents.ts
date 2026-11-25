import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireGatheringUserId } from '../http.js';
import {
  cleanDocumentObjects, completeDocument, deleteDocument, deleteDocumentFolder, downloadDocument,
  listDocumentEvents, listDocuments, reserveDocument, saveDocumentFolder, updateDocument,
} from '../documents/service.js';

const base = '/api/gathering/groups/:groupId/documents';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const name = z.string().trim().min(1).max(180)
  .refine((value) => value !== '.' && value !== '..' && !/[\p{Cc}\p{Cf}\\/:*?"<>|]/u.test(value), '파일 또는 폴더 이름을 확인해 주세요.');
const location = z.object({ folderId: id.nullable().default(null), eventId: id.nullable().default(null) });
const offset = z.coerce.number().int().min(0).max(100000).default(0);
const list = location.extend({ q: z.string().trim().max(180).optional(), sort: z.enum(['recent','name']).default('recent'), offset });
const folderPatch = z.object({ name: name.optional(), parentId: id.nullable().optional() });
const upload = location.extend({
  name, mimeType: z.string().max(150).optional(), sizeBytes: z.number().int().positive().max(100 * 1024 ** 2),
});

function actor(request: FastifyRequest) {
  return { groupId: z.object({ groupId: id }).parse(request.params).groupId, userId: requireGatheringUserId(request) };
}
function resource(request: FastifyRequest) {
  return z.object({ id }).parse(request.params).id;
}

export const gatheringDocumentRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };
  app.get(base, auth, (req) => listDocuments(actor(req), list.parse(req.query)));
  app.get(base + '/events', auth, (req) => listDocumentEvents(actor(req), z.object({ offset }).parse(req.query).offset));
  app.post(base + '/folders', auth, (req) => saveDocumentFolder(actor(req), null, folderPatch.required({ name: true }).parse(req.body)));
  app.patch(base + '/folders/:id', auth, (req) => saveDocumentFolder(actor(req), resource(req), folderPatch.parse(req.body)));
  app.delete(base + '/folders/:id', auth, (req) => deleteDocumentFolder(actor(req), resource(req)));
  app.post(base + '/uploads', auth, (req) => reserveDocument(actor(req), upload.parse(req.body)));
  app.post(base + '/files/:id/complete', auth, (req) => completeDocument(actor(req), resource(req)));
  app.get(base + '/files/:id/download', auth, (req) => downloadDocument(actor(req), resource(req)));
  app.patch(base + '/files/:id', auth, (req) => updateDocument(actor(req), resource(req),
    z.object({ name: name.optional(), location: location.optional() }).parse(req.body)));
  app.delete(base + '/files/:id', auth, (req) => deleteDocument(actor(req), resource(req)));

  if (process.env.NODE_ENV !== 'test') {
    let running: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (running) return;
      running = cleanDocumentObjects().catch(() => {
        app.log.warn('Document storage cleanup will retry');
      }).finally(() => { running = null; });
    }, 5 * 60 * 1000);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
      await running;
    });
  }
};
