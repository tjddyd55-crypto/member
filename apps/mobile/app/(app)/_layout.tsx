import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { theme } from '../../src/theme';

export default function AppLayout() {
  const { booting, user, membership } = useAuth();

  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.colors.primary.default} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  if (membership?.status === 'PENDING') return <Redirect href="/(auth)/join/pending" />;
  if (membership?.status !== 'ACTIVE') return <Redirect href="/(auth)/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
