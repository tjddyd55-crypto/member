import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  gatheringDueSchema,
  gatheringFinanceQuerySchema,
  gatheringMediaCompleteSchema,
  gatheringReceiptUploadSchema,
  gatheringTransactionSchema,
} from '@member/contracts';
import { upsertDue } from '../finance/dues.js';
import {
  completeReceiptUpload,
  createReceiptUploads,
  deleteReceipt,
  downloadReceipt,
  listReceipts,
} from '../finance/receipts.js';
import { financeSummary } from '../finance/summary.js';
import {
  createTransaction,
  deleteTransaction,
  listEventTransactions,
  updateTransaction,
} from '../finance/transactions.js';
import { requireGatheringUserId } from '../http.js';

const groupParams = z.object({ groupId: z.string().min(1) });
const financeYear = z.number().int().min(2000).max(2100);
const yearParams = groupParams.extend({ year: z.coerce.number().pipe(financeYear) });
const generalTransactionSchema = gatheringTransactionSchema.extend({ year: financeYear.optional() });
const eventParams = z.object({ groupId: z.string().min(1), eventId: z.string().min(1) });
const transactionParams = z.object({ groupId: z.string().min(1), transactionId: z.string().min(1) });
const receiptParams = eventParams.extend({ receiptId: z.string().min(1) });
const receiptIdParams = z.object({ groupId: z.string().min(1), receiptId: z.string().min(1) });

export const gatheringFinanceRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticateGathering] };

  app.get('/api/gathering/groups/:groupId/finance', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const query = gatheringFinanceQuerySchema.parse(request.query);
    return financeSummary(requireGatheringUserId(request), params.groupId, query.year);
  });

  app.post('/api/gathering/groups/:groupId/finance/dues', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = gatheringDueSchema.parse(request.body);
    return upsertDue(requireGatheringUserId(request), params.groupId, body);
  });

  app.get('/api/gathering/groups/:groupId/events/:eventId/transactions', auth, async (request) => {
    const params = eventParams.parse(request.params);
    return listEventTransactions(requireGatheringUserId(request), params.groupId, params.eventId);
  });

  app.post('/api/gathering/groups/:groupId/events/:eventId/transactions', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = gatheringTransactionSchema.parse(request.body);
    return createTransaction(requireGatheringUserId(request), params.groupId, params.eventId, body);
  });

  app.post('/api/gathering/groups/:groupId/finance/general-transactions', auth, async (request) => {
    const { groupId } = groupParams.parse(request.params);
    const body = generalTransactionSchema.parse(request.body);
    return createTransaction(requireGatheringUserId(request), groupId, null, body);
  });

  app.put('/api/gathering/groups/:groupId/transactions/:transactionId', auth, async (request) => {
    const params = transactionParams.parse(request.params);
    const body = generalTransactionSchema.parse(request.body);
    return updateTransaction(requireGatheringUserId(request), params.groupId, params.transactionId, body);
  });

  app.delete('/api/gathering/groups/:groupId/transactions/:transactionId', auth, async (request) => {
    const params = transactionParams.parse(request.params);
    return deleteTransaction(requireGatheringUserId(request), params.groupId, params.transactionId);
  });

  app.get('/api/gathering/groups/:groupId/events/:eventId/receipts', auth, async (request) => {
    const params = eventParams.parse(request.params);
    return listReceipts(requireGatheringUserId(request), params.groupId, params.eventId);
  });

  app.post('/api/gathering/groups/:groupId/events/:eventId/receipts/uploads', auth, async (request) => {
    const params = eventParams.parse(request.params);
    const body = gatheringReceiptUploadSchema.parse(request.body);
    return createReceiptUploads(requireGatheringUserId(request), params.groupId, params.eventId, body.items);
  });

  app.post('/api/gathering/groups/:groupId/events/:eventId/receipts/:receiptId/complete', auth, async (request) => {
    const params = receiptParams.parse(request.params);
    const body = gatheringMediaCompleteSchema.parse(request.body);
    return completeReceiptUpload(
      requireGatheringUserId(request),
      params.groupId,
      params.eventId,
      params.receiptId,
      body.sizeBytes,
    );
  });

  app.get('/api/gathering/groups/:groupId/finance/years/:year/receipts', auth, async (request) => {
    const { groupId, year } = yearParams.parse(request.params);
    return listReceipts(requireGatheringUserId(request), groupId, year);
  });

  app.post('/api/gathering/groups/:groupId/finance/years/:year/receipts/uploads', auth, async (request) => {
    const { groupId, year } = yearParams.parse(request.params);
    const body = gatheringReceiptUploadSchema.parse(request.body);
    return createReceiptUploads(requireGatheringUserId(request), groupId, year, body.items);
  });

  app.post('/api/gathering/groups/:groupId/finance/years/:year/receipts/:receiptId/complete', auth, async (request) => {
    const { groupId, year, receiptId } = yearParams.extend({ receiptId: receiptIdParams.shape.receiptId }).parse(request.params);
    const body = gatheringMediaCompleteSchema.parse(request.body);
    return completeReceiptUpload(requireGatheringUserId(request), groupId, year, receiptId, body.sizeBytes);
  });

  app.get('/api/gathering/groups/:groupId/receipts/:receiptId/download', auth, async (request) => {
    const params = receiptIdParams.parse(request.params);
    return downloadReceipt(requireGatheringUserId(request), params.groupId, params.receiptId);
  });

  app.delete('/api/gathering/groups/:groupId/receipts/:receiptId', auth, async (request) => {
    const params = receiptIdParams.parse(request.params);
    return deleteReceipt(requireGatheringUserId(request), params.groupId, params.receiptId);
  });
};
