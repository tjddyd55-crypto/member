import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { LoadingState, Screen } from '../../src/design/ui';

export default function AppLayout() {
  const { booting, user } = useAuth();
  if (booting) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
