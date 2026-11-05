import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { APP_NAME, DISCLAIMER } from '../src/copy';
import { useAuth } from '../src/auth/AuthProvider';
import { recoveryReveal } from '../src/session/recovery-reveal';
import { inviteStorage } from '../src/storage/secure';
import { theme } from '../src/theme';

export default function SplashScreen() {
  const { booting, user } = useAuth();
  const [pendingInvite, setPendingInvite] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void inviteStorage.get().then((token) => setPendingInvite(token));
  }, [user]);

  if (booting || pendingInvite === undefined) {
    return (
      <View style={styles.screen}>
        <Text style={styles.mark}>{APP_NAME}</Text>
        <Text style={styles.sub}>모임</Text>
        <ActivityIndicator color={theme.colors.primary.default} />
        <Text style={styles.note}>{DISCLAIMER}</Text>
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/login" />;
  if (recoveryReveal.has()) return <Redirect href="/(auth)/recovery-codes" />;
  if (pendingInvite) return <Redirect href={`/invite/${pendingInvite}`} />;
  return <Redirect href="/(app)/groups" />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg.default,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space[24],
    gap: theme.space[12],
  },
  mark: { ...theme.typography.display, color: theme.colors.text.primary },
  sub: { ...theme.typography.sectionTitle, color: theme.colors.accent },
  note: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginTop: theme.space[24],
  },
});
