import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import type { GatheringGroupSummary } from '@member/contracts';
import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthProvider';
import { APP_NAME, roleLabel } from '../../../src/copy';
import {
  Body,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
  Title,
} from '../../../src/design/ui';
import { theme } from '../../../src/theme';

export default function GroupsScreen() {
  const { profile, logout } = useAuth();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GatheringGroupSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const load = useCallback(async (q?: string) => {
    setStatus('loading');
    try {
      const result = await api.groups(q);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '모임 목록을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <Title>{APP_NAME}</Title>
      <Body>내 모임</Body>
      {!profile ? (
        <Button label="이름과 소속 로컬 등록" onPress={() => router.push('/(app)/profile')} />
      ) : null}
      <TextField
        label="모임 검색"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => void load(query)}
      />
      <Button label="검색" variant="secondary" onPress={() => void load(query)} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? (
        <ErrorState message={message} onRetry={() => void load(query)} />
      ) : null}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState
          title="참여 중인 모임이 없습니다"
          description="모임을 만들거나 초대 코드로 들어가세요."
        />
      ) : null}
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          disabled={item.membershipStatus !== 'ACTIVE'}
          onPress={() => router.push(`/(app)/groups/${item.id}`)}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardMeta}>
            {item.membershipStatus === 'PENDING' ? '승인 대기' : item.roles.map((role) => roleLabel(role)).join(', ') || '일반 회원'} ·
            회원 {item.memberCount}명
          </Text>
          <Text style={styles.cardMeta}>협의회장 {item.presidentName ?? '미정'}</Text>
          <Text style={styles.cardMeta}>
            {item.financeYear ? `${item.financeYear} 회계연도` : '회계연도 정보 없음'} · 다음 일정은
            일정 기능이 준비되면 표시됩니다
          </Text>
        </Pressable>
      ))}
      <Button label="전체 일정" variant="secondary" onPress={() => router.push('/(app)/calendar')} />
      <Button label="모임 만들기" onPress={() => router.push('/(app)/groups/create')} />
      <TextField
        label="초대 코드"
        value={inviteCode}
        onChangeText={setInviteCode}
        autoCapitalize="none"
      />
      <Button
        label="초대 코드로 참여"
        variant="secondary"
        onPress={() => {
          const token = normalizeInviteToken(inviteCode);
          if (token) router.push(`/invite/${encodeURIComponent(token)}`);
        }}
      />
      <Button label="로그아웃" variant="text" onPress={() => void logout()} />
    </Screen>
  );
}

function normalizeInviteToken(raw: string) {
  const trimmed = raw.trim();
  const marker = 'invite/';
  const index = trimmed.lastIndexOf(marker);
  return index >= 0 ? trimmed.slice(index + marker.length) : trimmed;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[16],
    padding: theme.space[16],
    gap: theme.space[8],
    backgroundColor: theme.colors.bg.default,
  },
  cardTitle: { ...theme.typography.cardTitle, color: theme.colors.text.primary, fontWeight: '700' },
  cardMeta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
