import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

export async function requestDownloadPermission() {
  if (Platform.OS === 'web') return true;
  const library = await import('expo-media-library');
  return (await library.requestPermissionsAsync(true, ['photo', 'video'])).granted;
}

export async function saveDownload(url: string, name: string) {
  if (Platform.OS === 'web') {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('파일을 받지 못했습니다.');
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  const library = await import('expo-media-library');
  if (!FileSystem.cacheDirectory) throw new Error('임시 저장 공간을 사용할 수 없습니다.');
  const cacheUri =
    FileSystem.cacheDirectory + 'album-' + Date.now() + '-' + encodeURIComponent(name);
  try {
    const result = await FileSystem.downloadAsync(url, cacheUri);
    if (result.status < 200 || result.status >= 300) throw new Error('파일을 받지 못했습니다.');
    await library.saveToLibraryAsync(result.uri);
  } finally {
    await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => undefined);
  }
}
