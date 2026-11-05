import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';

export const queuedReportStatuses = ['OPEN', 'REVIEWING'] as const;

export async function reportMedia(userId: string, groupId: string, assetId: string, reason: string) {
  await requireGroupMember(userId, groupId);
  const asset = await prisma.gatheringMediaAsset.findFirst({
    where: { id: assetId, groupId, status: 'READY', deletedAt: null },
    select: { id: true },
  });
  if (!asset) throw new AppError(404, 'MEDIA_NOT_FOUND', '사진·영상을 찾을 수 없습니다.');
  const report = await prisma.gatheringMediaReport.create({
    data: { groupId, mediaAssetId: assetId, reporterUserId: userId, reason, status: 'OPEN' },
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.MEDIA_REPORT,
    targetType: 'GatheringMediaReport',
    targetId: report.id,
  });
  return { id: report.id, status: report.status };
}

export async function listMediaReports(userId: string, groupId: string) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_MODERATE');
  const items = await prisma.gatheringMediaReport.findMany({
    where: { groupId, status: { in: [...queuedReportStatuses] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      mediaAssetId: item.mediaAssetId,
      reason: item.reason,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

export async function resolveMediaReport(
  userId: string,
  groupId: string,
  reportId: string,
  status: 'RESOLVED' | 'DISMISSED',
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'MEDIA_MODERATE');
  const updated = await prisma.gatheringMediaReport.updateMany({
    where: { id: reportId, groupId, status: { in: [...queuedReportStatuses] } },
    data: { status, resolvedAt: new Date() },
  });
  if (updated.count !== 1) throw new AppError(404, 'REPORT_NOT_FOUND', '신고를 찾을 수 없습니다.');
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.MEDIA_REPORT_RESOLVE,
    targetType: 'GatheringMediaReport',
    targetId: reportId,
    meta: { status },
  });
  return { ok: true as const, status };
}
