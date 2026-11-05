import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { api } from '../../src/api/client';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Title } from '../../src/design/ui';
import { monthRange, shiftMonth } from '../../src/features/schedule/range';
import { theme } from '../../src/theme';

export default function CalendarScreen() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState<GatheringEventView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const range = monthRange(anchor);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await api.calendar(range.from, range.to);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '일정을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <Title>전체 일정</Title>
      <BodyLine label={range.label} onPrev={() => setAnchor((value) => shiftMonth(value, -1))} onNext={() => setAnchor((value) => shiftMonth(value, 1))} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="이 달의 일정이 없습니다" description="속한 모임의 행사가 있으면 여기 모입니다." />
      ) : null}
      {items.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          onPress={() => router.push(`/(app)/groups/${event.groupId}/events/${event.id}`)}
        >
          <Text style={{ color: theme.colors.text.primary }}>{event.title}</Text>
          <Text style={{ color: theme.colors.text.secondary }}>
            {event.groupName} · {new Date(event.startsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </Text>
        </Pressable>
      ))}
      <Button label="내 모임" variant="text" onPress={() => router.replace('/(app)/groups')} />
    </Screen>
  );
}

function BodyLine({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button label="이전달" variant="text" onPress={onPrev} />
      <Text style={{ color: theme.colors.text.primary }}>{label}</Text>
      <Button label="다음달" variant="text" onPress={onNext} />
    </View>
  );
}
