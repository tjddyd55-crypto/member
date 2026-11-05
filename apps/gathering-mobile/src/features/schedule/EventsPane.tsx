import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { api } from '../../api/client';
import { Button, EmptyState, ErrorState, LoadingState } from '../../design/ui';
import { theme } from '../../theme';
import { monthRange, shiftMonth } from './range';

export function EventsPane({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState<GatheringEventView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const range = monthRange(anchor);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await api.events(groupId, range.from, range.to);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '일정을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ gap: theme.space[12] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button label="이전달" variant="text" onPress={() => setAnchor((value) => shiftMonth(value, -1))} />
        <Text style={{ color: theme.colors.text.primary }}>{range.label}</Text>
        <Button label="다음달" variant="text" onPress={() => setAnchor((value) => shiftMonth(value, 1))} />
      </View>
      {canManage ? (
        <Button label="행사 만들기" onPress={() => router.push(`/(app)/groups/${groupId}/events/new`)} />
      ) : null}
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="이 달의 행사가 없습니다" description="회장이나 총무가 행사를 등록하면 여기에 표시됩니다." />
      ) : null}
      {items.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          onPress={() => router.push(`/(app)/groups/${groupId}/events/${event.id}`)}
          style={{ gap: 4, paddingVertical: theme.space[8] }}
        >
          <Text style={{ color: theme.colors.text.primary, fontSize: 16 }}>{event.title}</Text>
          <Text style={{ color: theme.colors.text.secondary }}>
            {new Date(event.startsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
            {event.status === 'CANCELLED' ? ' · 취소' : ''}
            {event.place ? ` · ${event.place}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
