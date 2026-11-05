import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../api/client';

/** 권한 거절과 토큰 발급 실패는 로그인 흐름을 막지 않는다. */
export async function syncPushRegistration() {
  if (Platform.OS === 'web') return;
  const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    const permission =
      current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      await api.registerPush({ permission: 'denied', platform });
      return;
    }
    const projectId = readProjectId();
    const token = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    await api.registerPush({ permission: 'granted', platform, token: token.data });
  } catch {
    await api.registerPush({ permission: 'denied', platform }).catch(() => undefined);
  }
}

function readProjectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}
