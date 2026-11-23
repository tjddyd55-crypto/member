import type { ExpoConfig } from 'expo/config';
import { APP_DISPLAY_NAME, ANDROID_PACKAGE, IOS_BUNDLE_ID } from './app-identity.js';

const config: ExpoConfig = {
  owner: 'tjddyd55',
  name: APP_DISPLAY_NAME,
  slug: 'jci-korea-gathering',
  version: '1.0.0',
  icon: './assets/icon.png',
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#130F2D' },
  orientation: 'portrait',
  scheme: 'jcikorea',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  plugins: [
    'expo-dev-client',
    'expo-router',
    'expo-secure-store',
    'expo-video',
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#0097D7' }],
    [
      'expo-image-picker',
      {
        photosPermission: '행사 사진과 영상을 올리기 위해 사진 보관함에 접근합니다.',
        microphonePermission: false,
        cameraPermission: false,
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission: '행사 사진과 영상을 올리기 위해 사진 보관함에 접근합니다.',
        savePhotosPermission: '선택한 사진과 영상을 사진 보관함에 저장합니다.',
        granularPermissions: ['photo', 'video'],
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    eas: {
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? 'f5a017a3-82f8-4d73-bc8a-ecd249e994f3',
    },
  },
  ios: {
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription: '행사 사진과 영상을 올리기 위해 사진 보관함에 접근합니다.',
    },
    bundleIdentifier: IOS_BUNDLE_ID,
  },
  android: {
    permissions: ['android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#130F2D',
    },
    package: ANDROID_PACKAGE,
    softwareKeyboardLayoutMode: 'resize',
  },
};

export default config;
