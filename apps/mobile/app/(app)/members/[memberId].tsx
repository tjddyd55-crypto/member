import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../src/api/client';
import {
  AppBar,
  Button,
  ErrorState,
  Screen,
  Skeleton,
} from '../../../src/design-system/components';
import { theme } from '../../../src/theme';

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value && value.length > 0 ? value : '비공개 또는 정보 없음'}</Text>
    </View>
  );
}

export default function MemberDetailScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const query = useQuery({
    queryKey: ['member', memberId],
    queryFn: () => api.member(String(memberId)),
    enabled: Boolean(memberId),
  });

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <AppBar title="회원 상세" right={<Button label="닫기" variant="text" onPress={() => router.back()} />} />
        {query.isLoading ? (
          <View style={styles.pad}>
            <Skeleton height={160} />
          </View>
        ) : query.isError ? (
          <ErrorState
            message={query.error instanceof Error ? query.error.message : '조회 실패'}
            onRetry={() => query.refetch()}
          />
        ) : query.data ? (
          <ScrollView contentContainerStyle={styles.pad}>
            <Text style={styles.name} numberOfLines={2}>
              {query.data.name}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {query.data.currentPositionText || '직책 없음'}
            </Text>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>기본</Text>
              <Row label="회원번호" value={query.data.memberNumber} />
              <Row label="분류" value={query.data.categoryName} />
              <Row label="한자" value={query.data.hanjaName} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>연락처</Text>
              <Row label="휴대폰" value={query.data.phone} />
              <Row label="이메일" value={query.data.email} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>직장</Text>
              <Row label="직장명" value={query.data.companyName} />
              <Row label="직위" value={query.data.companyPosition} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>기타</Text>
              <Row label="자택" value={query.data.homeAddress} />
              <Row label="취미" value={query.data.hobby} />
              <Row label="특기" value={query.data.specialty} />
            </View>
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: theme.layout.horizontalGutter, gap: theme.space[16], paddingBottom: theme.space[32] },
  name: { ...theme.typography.pageTitle, color: theme.colors.text.primary },
  sub: { ...theme.typography.body, color: theme.colors.text.secondary },
  section: {
    gap: theme.space[8],
    padding: theme.space[16],
    borderRadius: theme.radius[16],
    borderWidth: 1,
    borderColor: theme.colors.border.default,
  },
  sectionTitle: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
  row: { gap: 4 },
  label: { ...theme.typography.caption, color: theme.colors.text.secondary },
  value: { ...theme.typography.body, color: theme.colors.text.primary },
});
