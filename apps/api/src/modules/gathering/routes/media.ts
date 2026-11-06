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
  completeFolderMediaUpload,
  completeMediaUpload,
  resumeFolderMediaUpload,
  createFolderMediaUploads,
  createMediaUploads,
  deleteMedia,
  resumeMediaUpload,
  storageSummary,
} from '../media/commands.js';
import { createMediaFolder, createUploadLink, listUploadLinks, publicComplete, publicReserve, publicUploadInfo, renameMediaFolder, setUploadLinkState } from '../media/links.js';
import { downloadMedia, listAlbums,
  listFolderMedia, listEventMedia } from '../media/queries.js';
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

  app.post('/api/gathering/groups/:groupId/events/:eventId/media/:assetId/resume', auth, async (request) => {
    const params = eventAssetParams.parse(request.params);
    return resumeMediaUpload(requireGatheringUserId(request), params.groupId, params.eventId, params.assetId);
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

  app.post('/api/gathering/groups/:groupId/folders', auth, async (request) => {
    const params = groupParams.parse(request.params);
    const body = z.object({ title: z.string() }).parse(request.body);
    return createMediaFolder(requireGatheringUserId(request), params.groupId, body.title);
  });

  app.post('/api/gathering/groups/:groupId/folders/:folderId/media/uploads', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaUploadSchema.parse(request.body);
    return createFolderMediaUploads(requireGatheringUserId(request), params.groupId, params.folderId, body.items);
  });

  app.post('/api/gathering/groups/:groupId/folders/:folderId/media/:assetId/resume', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1), assetId: z.string().min(1) }).parse(request.params);
    return resumeFolderMediaUpload(requireGatheringUserId(request), params.groupId, params.folderId, params.assetId);
  });

  app.post('/api/gathering/groups/:groupId/folders/:folderId/media/:assetId/complete', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1), assetId: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaCompleteSchema.parse(request.body);
    return completeFolderMediaUpload(
      requireGatheringUserId(request),
      params.groupId,
      params.folderId,
      params.assetId,
      body.sizeBytes,
    );
  });

  app.get('/api/gathering/groups/:groupId/folders/:folderId/media', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
    const query = z.object({ cursor: z.string().optional() }).parse(request.query);
    return listFolderMedia(requireGatheringUserId(request), params.groupId, params.folderId, query.cursor);
  });

  app.post('/api/gathering/groups/:groupId/folders/:folderId', auth, async (request) => {
    const params = groupParams.extend({ folderId: z.string().min(1) }).parse(request.params);
    const body = z.object({ title: z.string() }).parse(request.body);
    return renameMediaFolder(requireGatheringUserId(request), params.groupId, params.folderId, body.title);
  });

  const linkBody = z.object({ eventId: z.string().min(1).optional(), folderId: z.string().min(1).optional() });
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
    return setUploadLinkState(requireGatheringUserId(request), params.groupId, params.linkId, params.action);
  });

  app.get('/api/gathering/public/uploads/:token', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const info = await publicUploadInfo(params.token);
    reply.type('text/html; charset=utf-8');
    return uploadPage(info.title, info.notice, params.token);
  });

  app.post('/api/gathering/public/uploads/:token/reserve', async (request) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaUploadSchema.parse(request.body);
    return publicReserve(params.token, body.items);
  });

  app.post('/api/gathering/public/uploads/:token/complete', async (request) => {
    const params = z.object({ token: z.string().min(1) }).parse(request.params);
    const body = gatheringMediaCompleteSchema.extend({ assetId: z.string().min(1) }).parse(request.body);
    return publicComplete(params.token, body.assetId, body.sizeBytes);
  });
};

function uploadPage(title: string, notice: string, token: string) {
  const safeTitle = title.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><body style="font-family:sans-serif;padding:24px"><h1>${safeTitle}</h1><p>${notice}</p><input id="files" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple><button id="go">올리기</button><pre id="log"></pre><script>
const token=${JSON.stringify(token)};
const log=document.getElementById('log');
document.getElementById('go').onclick=async()=>{
  try{
  const files=[...document.getElementById('files').files];
  const items=[];
  for(const file of files){
    const item={kind:file.type.startsWith('video/')?'VIDEO':'PHOTO',mimeType:file.type,sizeBytes:file.size,originalName:file.name};
    if(item.kind==='VIDEO') item.durationMs=await videoDurationMs(file);
    items.push(item);
  }
  const reserved=await fetch('/api/gathering/public/uploads/'+token+'/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items})});
  const body=await reserved.json();
  if(!reserved.ok){log.textContent=body.error?.message||'실패';return;}
  for(let i=0;i<files.length;i++){
    const item=body.items[i];
    const put=await fetch(item.uploadUrl,{method:'PUT',headers:item.headers,body:files[i]});
    if(!put.ok){log.textContent='전송 실패';return;}
    const done=await fetch('/api/gathering/public/uploads/'+token+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assetId:item.id,sizeBytes:files[i].size})});
    if(!done.ok){log.textContent='확인 실패';return;}
  }
  log.textContent='올렸습니다. 모임 앨범에 바로 보입니다.';
  }catch(error){ log.textContent='영상 길이를 읽지 못했습니다.'; }
};
function videoDurationMs(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const video=document.createElement('video');
    video.preload='metadata';
    video.onloadedmetadata=()=>{
      URL.revokeObjectURL(url);
      const durationMs=Math.round(video.duration*1000);
      if(!Number.isFinite(durationMs)||durationMs<=0) reject(new Error('duration'));
      else resolve(durationMs);
    };
    video.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('duration')); };
    video.src=url;
  });
}
</script></body></html>`;
}
