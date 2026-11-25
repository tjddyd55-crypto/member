import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

export async function saveToDownloads(uri: string, name: string, mimeType: string) {
  if (Number(Platform.Version) < 29) return false;
  await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
    { name, mimeType, parentFolder: 'JCI KOREA' },
    'Download',
    decodeURIComponent(uri.replace(/^file:\/\//, '')),
  );
  return true;
}
