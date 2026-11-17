import { Redirect, Stack, usePathname } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { LoadingState, Screen } from '../../src/design/ui';
import { AppChrome } from '../../src/features/group/AppChrome';

export default function AppLayout() {
  const { booting, user } = useAuth();
  const pathname = usePathname();
  if (pathname === '/legal/privacy' || pathname === '/legal/terms') {
    return <Stack screenOptions={{ headerShown: false }} />;
  }
  if (booting) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <AppChrome>
      <Stack screenOptions={{ headerShown: false }} />
    </AppChrome>
  );
}
