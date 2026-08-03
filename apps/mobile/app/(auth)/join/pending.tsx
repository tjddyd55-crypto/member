import { StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppBar, Button, Screen } from '../../../src/design-system/components';
import { useAuth } from '../../../src/auth/AuthProvider';
import { theme } from '../../../src/theme';

export default function PendingScreen() {
  const { membership, logout, user } = useAuth();

  if (!user) return <Redirect href="/(auth)/login" />;
  if (membership?.status === 'ACTIVE') return <Redirect href="/(app)/(tabs)/home" />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <AppBar title="승인 대기" />
        <View style={styles.box}>
          <Text style={styles.title}>가입 승인 대기 중</Text>
          <Text style={styles.body}>
            관리자 승인 후 회원수첩을 이용할 수 있습니다. 승인 전까지 다른 메뉴에는 접근할 수
            없습니다.
          </Text>
          <Button
            label="로그아웃"
            variant="secondary"
            onPress={async () => {
              await logout();
              router.replace('/(auth)/login');
            }}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, padding: theme.layout.horizontalGutter, gap: theme.space[16], justifyContent: 'center' },
  title: { ...theme.typography.pageTitle, color: theme.colors.text.primary },
  body: { ...theme.typography.body, color: theme.colors.text.secondary },
});
