import type { DocumentPickerAsset } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { downloadAsync, getContentUriAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import { putPreparedFile } from '../media/prepare';
import type { DocumentFile } from './api';
import { saveToDownloads } from './save-to-downloads';

export async function uploadDocument(
  asset: DocumentPickerAsset, target: { url: string; headers: Record<string, string> },
  progress: (loaded: number, total: number) => void,
) {
  if (Platform.OS !== 'web') return putPreparedFile(asset.uri, target.url, target.headers, progress);
  if (!asset.file) throw new Error('선택한 파일을 읽지 못했습니다.');
  const file = asset.file;
  await new Promise<void>((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('PUT', target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      if (name.toLowerCase() !== 'content-length') req.setRequestHeader(name, value);
    }
    req.upload.onprogress = ({ loaded, total }) => progress(loaded, total);
    req.onload = () => req.status >= 200 && req.status < 300 ? resolve() : reject(new Error('파일 전송에 실패했습니다.'));
    req.onerror = () => reject(new Error('파일 전송에 실패했습니다.'));
    req.send(file);
  });
}

async function localDocument(url: string, file: DocumentFile) {
  const dir = new Directory(Paths.cache, 'documents', file.id);
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, file.name);
  const result = await downloadAsync(url, dest.uri);
  if (result.status !== 200 || dest.size !== file.sizeBytes) {
    if (dest.exists) dest.delete();
    throw new Error('파일을 다운로드하지 못했습니다.');
  }
  return dest;
}

export async function transferDocumentFile(url: string, file: DocumentFile, action: 'open' | 'download' | 'share') {
  if (Platform.OS === 'web') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('파일을 다운로드하지 못했습니다.');
    const blob = await response.blob();
    if (action === 'share' && navigator.canShare?.({ files: [new globalThis.File([blob], file.name, { type: file.mimeType })] })) {
      await navigator.share({ files: [new globalThis.File([blob], file.name, { type: file.mimeType })] });
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  const local = await localDocument(url, file);
  if (action === 'download' && await saveToDownloads(local.uri, file.name, file.mimeType)) return;
  if (Platform.OS === 'android' && action === 'open') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: await getContentUriAsync(local.uri), type: file.mimeType, flags: 1,
      });
      return;
    } catch {
      // The system share sheet can offer other installed handlers.
    }
  }
  await Sharing.shareAsync(local.uri, { mimeType: file.mimeType, dialogTitle: file.name });
}
