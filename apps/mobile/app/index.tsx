import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { theme } from '../src/theme';

export default function Index() {
  const { booting, user, membership } = useAuth();

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary.default} />
      </View>
    );
  }

  if (!user || !membership) return <Redirect href="/(auth)/login" />;
  if (membership.status === 'PENDING') return <Redirect href="/(auth)/join/pending" />;
  return <Redirect href="/(app)/(tabs)/home" />;
}
