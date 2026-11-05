import { File, Paths } from 'expo-file-system';
import { createUploadTask, FileSystemUploadType } from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import {
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_MS,
  fittedPhotoSize,
  validateMediaUpload,
} from '@member/gathering-domain';

export type PreparedUpload = {
  uri: string;
  kind: 'PHOTO' | 'VIDEO';
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  originalName?: string;
};

/** 사진은 JPEG로 줄여 올리고 원본 파일은 보관하지 않는다. 영상은 길이만 검사한다. */
export async function prepareAsset(asset: ImagePickerAsset): Promise<PreparedUpload> {
  if (asset.type === 'video') return prepareVideo(asset);
  return preparePhoto(asset);
}

async function preparePhoto(asset: ImagePickerAsset): Promise<PreparedUpload> {
  const fitted = fittedPhotoSize(asset.width ?? 0, asset.height ?? 0);
  const actions = fitted ? [{ resize: { width: fitted.width, height: fitted.height } }] : [];
  const compressed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: PHOTO_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const sizeBytes = fileBytes(compressed.uri);
  const decision = validateMediaUpload({ kind: 'PHOTO', mimeType: 'image/jpeg', sizeBytes });
  if (!decision.ok) throw new Error(rejectionMessage(decision.code));
  return {
    uri: compressed.uri,
    kind: 'PHOTO',
    mimeType: 'image/jpeg',
    sizeBytes,
    width: compressed.width,
    height: compressed.height,
    originalName: asset.fileName ?? undefined,
  };
}

async function prepareVideo(asset: ImagePickerAsset): Promise<PreparedUpload> {
  const durationMs = asset.duration ?? null;
  const mimeType = asset.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  const sizeBytes = asset.fileSize && asset.fileSize > 0 ? asset.fileSize : fileBytes(asset.uri);
  const decision = validateMediaUpload({ kind: 'VIDEO', mimeType, sizeBytes, durationMs });
  if (!decision.ok) throw new Error(rejectionMessage(decision.code));
  return {
    uri: asset.uri,
    kind: 'VIDEO',
    mimeType,
    sizeBytes,
    durationMs: durationMs ?? undefined,
    width: asset.width,
    height: asset.height,
    originalName: asset.fileName ?? undefined,
  };
}

export async function putPreparedFile(
  uri: string,
  url: string,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
) {
  const uploadUri = copyContentUriToCache(uri);
  try {
    const task = createUploadTask(
      url,
      uploadUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        headers,
      },
      (progress) => onProgress(progress.totalBytesSent, progress.totalBytesExpectedToSend),
    );
    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error('파일 전송에 실패했습니다.');
    }
  } finally {
    if (uploadUri !== uri) {
      try {
        new File(uploadUri).delete();
      } catch {
        // 캐시 사본 정리는 업로드 결과보다 뒤다.
      }
    }
  }
}

/** Android 문서 선택기는 content:// 를 준다. 레거시 업로드는 file:// 만 읽는다. */
function copyContentUriToCache(uri: string) {
  if (!uri.startsWith('content:')) return uri;
  const source = new File(uri);
  const extension = source.extension || '';
  const destination = new File(Paths.cache, `upload-${Date.now()}${extension}`);
  source.copy(destination);
  return destination.uri;
}

function fileBytes(uri: string) {
  const size = new File(uri).size;
  if (typeof size !== 'number' || size <= 0) throw new Error('파일 크기를 확인하지 못했습니다.');
  if (size > Math.max(PHOTO_MAX_BYTES, VIDEO_MAX_BYTES)) {
    throw new Error('파일 크기 제한을 넘었습니다.');
  }
  return size;
}

function rejectionMessage(code: string) {
  if (code === 'VIDEO_TOO_LONG' || code === 'DURATION_REQUIRED') return '영상은 5분까지 올릴 수 있습니다.';
  if (code === 'FILE_TOO_LARGE') return '파일 크기 제한을 넘었습니다.';
  return '올릴 수 없는 파일 형식입니다.';
}

export const VIDEO_LIMIT_LABEL = `영상은 ${VIDEO_MAX_DURATION_MS / 60000}분까지`;
