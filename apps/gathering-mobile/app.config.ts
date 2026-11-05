import type { ExpoConfig } from 'expo/config';
import {
  APP_DISPLAY_NAME,
  PROVISIONAL_ANDROID_PACKAGE,
  PROVISIONAL_IOS_BUNDLE_ID,
} from './app-identity';

const config: ExpoConfig = {
  name: APP_DISPLAY_NAME,
  slug: 'jci-korea-gathering',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'jcikorea',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-notifications',
    [
      'expo-image-picker',
      {
        photosPermission: '행사 사진과 영상을 올리기 위해 앨범 접근이 필요합니다.',
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    },
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: PROVISIONAL_IOS_BUNDLE_ID,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#1B3A6B',
    },
    package: PROVISIONAL_ANDROID_PACKAGE,
  },
};

export default config;
