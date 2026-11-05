import type { GatheringMediaAsset } from '@prisma/client';
import type { GatheringMediaView } from '@member/contracts';

export function presentMedia(asset: GatheringMediaAsset, viewerId: string): GatheringMediaView {
  return {
    id: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    createdAt: asset.createdAt.toISOString(),
    uploaderUserId: asset.uploaderUserId,
    mine: asset.uploaderUserId === viewerId,
  };
}

export function encodeMediaCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeMediaCursor(cursor: string) {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const splitAt = decoded.lastIndexOf('|');
  if (splitAt <= 0) return null;
  const createdAt = new Date(decoded.slice(0, splitAt));
  const id = decoded.slice(splitAt + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}
