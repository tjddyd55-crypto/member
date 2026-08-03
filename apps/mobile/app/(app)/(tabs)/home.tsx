import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isAdminRole } from '@member/shared';
import { AppBar, Button, Screen } from '../../../src/design-system/components';
import { useAuth } from '../../../src/auth/AuthProvider';
import { theme } from '../../../src/theme';

export default function HomeScreen() {
  const { membership } = useAuth();
  const admin = membership ? isAdminRole(membership.role as 'MEMBER' | 'LOCAL_ADMIN' | 'LOCAL_OWNER') : false;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title={membership?.local.name ?? '홈'} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.slogan}>{membership?.local.slogan ?? '올해의 슬로건'}</Text>
            <Text style={styles.hello}>
              안녕하세요, {membership?.memberProfile?.name ?? '회원'}님
            </Text>
            {admin ? (
              <Text style={styles.badge}>관리자</Text>
            ) : (
              <Text style={styles.meta}>일반회원</Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>빠른 메뉴</Text>
            <Button label="회원수첩 보기" onPress={() => router.push('/(app)/(tabs)/members')} />
            <Button
              label="내정보"
              variant="secondary"
              onPress={() => router.push('/(app)/(tabs)/profile')}
            />
          </View>

          {admin ? (
            <View style={styles.card}>
              <Text style={styles.section}>관리자</Text>
              <Text style={styles.meta}>가입 승인·회원 관리는 다음 단계에서 제공됩니다.</Text>
              <Button label="관리자 메뉴 (준비중)" variant="secondary" onPress={() => router.push('/(app)/admin')} />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.layout.horizontalGutter, gap: theme.space[16], paddingBottom: theme.space[32] },
  hero: {
    padding: theme.space[20],
    borderRadius: theme.radius[16],
    backgroundColor: theme.colors.primary.soft,
    gap: theme.space[8],
  },
  slogan: { ...theme.typography.sectionTitle, color: theme.colors.primary.default },
  hello: { ...theme.typography.body, color: theme.colors.text.primary },
  badge: {
    alignSelf: 'flex-start',
    ...theme.typography.badge,
    color: theme.colors.text.onPrimary,
    backgroundColor: theme.colors.primary.default,
    overflow: 'hidden',
    paddingHorizontal: theme.space[12],
    paddingVertical: theme.space[4],
    borderRadius: theme.radius.full,
  },
  card: {
    gap: theme.space[12],
    padding: theme.space[16],
    borderRadius: theme.radius[16],
    borderWidth: 1,
    borderColor: theme.colors.border.default,
  },
  section: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
