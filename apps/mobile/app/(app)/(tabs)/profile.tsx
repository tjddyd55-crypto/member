import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isAdminRole } from '@member/shared';
import { AppBar, Button, Screen } from '../../../src/design-system/components';
import { useAuth } from '../../../src/auth/AuthProvider';
import { theme } from '../../../src/theme';

export default function ProfileScreen() {
  const { membership, logout } = useAuth();
  const admin = membership ? isAdminRole(membership.role as 'MEMBER' | 'LOCAL_ADMIN' | 'LOCAL_OWNER') : false;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title="내정보" />
        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.name}>{membership?.memberProfile?.name ?? '-'}</Text>
            <Text style={styles.meta}>{membership?.local.name}</Text>
            <Text style={styles.meta}>{membership?.memberProfile?.currentPositionText ?? '직책 없음'}</Text>
            <Text style={styles.meta}>회원번호 {membership?.memberProfile?.memberNumber ?? '-'}</Text>
            {admin ? <Text style={styles.badge}>관리자</Text> : null}
          </View>
          {admin ? (
            <Button label="관리자 메뉴" variant="secondary" onPress={() => router.push('/(app)/admin')} />
          ) : null}
          <Button
            label="로그아웃"
            variant="danger"
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
  content: { padding: theme.layout.horizontalGutter, gap: theme.space[16] },
  card: {
    gap: theme.space[8],
    padding: theme.space[20],
    borderRadius: theme.radius[16],
    borderWidth: 1,
    borderColor: theme.colors.border.default,
  },
  name: { ...theme.typography.pageTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.body, color: theme.colors.text.secondary },
  badge: {
    alignSelf: 'flex-start',
    marginTop: theme.space[8],
    ...theme.typography.badge,
    color: theme.colors.primary.default,
    backgroundColor: theme.colors.primary.soft,
    paddingHorizontal: theme.space[12],
    paddingVertical: theme.space[4],
    borderRadius: theme.radius.full,
    overflow: 'hidden',
  },
});
