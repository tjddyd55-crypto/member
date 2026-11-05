import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'JCI KOREA',
  slug: 'jci-korea-gathering',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'jcikorea',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'kr.gathering.mobile',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#1B3A6B',
    },
    package: 'kr.gathering.mobile',
  },
};

export default config;
