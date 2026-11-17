import { Platform } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { api } from '../../api/client';
import { putPreparedFile } from './prepare';

const thumbnails = new Map<string, Promise<string>>();
const backfilled = new Set<string>();
const waiting: (() => void)[] = [];
let running = 0;

async function queued<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running += 1;
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export function videoThumbnail(assetId: string, uri: string): Promise<string> {
  const cached = thumbnails.get(assetId);
  if (cached) return cached;
  const result = queued(async () => {
    const frame = await VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.7 });
    const resize =
      Math.max(frame.width, frame.height) > 480
        ? [{ resize: frame.width >= frame.height ? { width: 480 } : { height: 480 } }]
        : [];
    const image = await ImageManipulator.manipulateAsync(frame.uri, resize, {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return image.uri;
  });
  thumbnails.set(assetId, result);
  return result;
}

export async function uploadVideoPoster(groupId: string, assetId: string, uri: string) {
  if (Platform.OS === 'web' || backfilled.has(assetId)) return;
  backfilled.add(assetId);
  try {
    const poster = await videoThumbnail(assetId, uri);
    const target = await api.posterUpload(groupId, assetId, new File(poster).size);
    await putPreparedFile(poster, target.uploadUrl, target.headers, () => undefined);
    await api.posterComplete(groupId, assetId);
  } catch {
    // A poster is optional; the completed video remains available.
  }
}
