import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../src/api/client';
import {
  AppBar,
  EmptyState,
  ErrorState,
  MemberCard,
  Screen,
  Skeleton,
} from '../../../src/design-system/components';
import { theme } from '../../../src/theme';

export default function MembersScreen() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = useQuery({
    queryKey: ['members', submitted],
    queryFn: () => api.members(submitted || undefined),
  });

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title="회원수첩" />
        <View style={styles.searchWrap}>
          <TextInput
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => setSubmitted(q.trim())}
            placeholder="이름·직장·직책 검색"
            placeholderTextColor={theme.colors.text.disabled}
            style={styles.search}
            returnKeyType="search"
          />
        </View>
        {query.isLoading ? (
          <View style={styles.listPad}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </View>
        ) : query.isError ? (
          <ErrorState
            message={query.error instanceof Error ? query.error.message : '불러오기 실패'}
            onRetry={() => query.refetch()}
          />
        ) : (
          <FlatList
            data={query.data?.items ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listPad}
            ListEmptyComponent={<EmptyState title="회원이 없습니다" description="검색 조건을 바꿔보세요." />}
            renderItem={({ item }) => (
              <MemberCard
                name={item.name}
                position={item.currentPositionText}
                company={item.companyName}
                onPress={() => router.push(`/(app)/members/${item.id}`)}
              />
            )}
          />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: theme.layout.horizontalGutter, paddingVertical: theme.space[12] },
  search: {
    minHeight: theme.layout.inputMinHeight,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[16],
    ...theme.typography.body,
    color: theme.colors.text.primary,
  },
  listPad: { padding: theme.layout.horizontalGutter, gap: theme.space[12], paddingBottom: theme.space[32] },
});
