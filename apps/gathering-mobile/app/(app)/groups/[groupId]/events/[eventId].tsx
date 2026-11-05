import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../../../../src/api/client';
import { UNBUILT_FINANCE } from '../../../../../src/copy';
import { MediaPane } from '../../../../../src/features/media/MediaPane';
import { Body, Button, EmptyState, ErrorState, LoadingState, Screen, TextField, Title } from '../../../../../src/design/ui';
import { theme } from '../../../../../src/theme';

const ATTENDANCE = [
  { status: 'ATTENDING', label: '참석' },
  { status: 'DECLINED', label: '불참' },
  { status: 'UNDECIDED', label: '미정' },
] as const;

type EventTab = 'info' | 'media' | 'finance';

export default function EventDetailScreen() {
  const params = useLocalSearchParams<{ groupId: string; eventId: string; tab?: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const eventId = typeof params.eventId === 'string' ? params.eventId : '';
  const [tab, setTab] = useState<EventTab>(params.tab === 'media' ? 'media' : 'info');
  const [event, setEvent] = useState<GatheringEventView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [place, setPlace] = useState('');
  const [title, setTitle] = useState('');
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [next, group] = await Promise.all([api.event(groupId, eventId), api.group(groupId)]);
      setEvent(next);
      setTitle(next.title);
      setPlace(next.place ?? '');
      setCanManage(group.permissions.includes('EVENT_MANAGE'));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '행사를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attend = async (next: (typeof ATTENDANCE)[number]['status']) => {
    const updated = await api.setAttendance(groupId, eventId, next);
    setEvent(updated);
  };

  const save = async () => {
    const startsAt = event?.startsAt;
    if (!startsAt) return;
    const updated = await api.updateEvent(groupId, eventId, { title, place });
    setEvent(updated);
  };

  return (
    <Screen>
      <Button label="모임으로" variant="text" onPress={() => router.replace(`/(app)/groups/${groupId}`)} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && event ? (
        <>
          <Title>{event.title}</Title>
          <Body>{new Date(event.startsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</Body>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {(
              [
                ['info', '안내·참석'],
                ['media', '사진·영상'],
                ['finance', '재무·영수증'],
              ] as const
            ).map(([id, label]) => (
              <Pressable key={id} accessibilityRole="tab" onPress={() => setTab(id)}>
                <Text style={{ color: tab === id ? theme.colors.accent : theme.colors.text.secondary }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {tab === 'media' ? <MediaPane eventId={eventId} groupId={groupId} /> : null}
          {tab === 'finance' ? <EmptyState title="재무 입력은 아직 없습니다" description={UNBUILT_FINANCE} /> : null}
          {tab === 'info' ? (
            <>
          <Body>{event.status === 'CANCELLED' ? '취소된 행사' : event.groupName}</Body>
          <Body>
            참석 {event.counts.attending} · 불참 {event.counts.declined} · 미정 {event.counts.undecided}
          </Body>
          {event.status === 'SCHEDULED'
            ? ATTENDANCE.map((item) => (
                <Button
                  key={item.status}
                  label={event.myAttendance === item.status ? `${item.label} 선택됨` : item.label}
                  variant={event.myAttendance === item.status ? 'primary' : 'secondary'}
                  onPress={() => void attend(item.status)}
                />
              ))
            : null}
          {canManage && event.status === 'SCHEDULED' ? (
            <>
              <TextField label="행사명" value={title} onChangeText={setTitle} />
              <TextField label="장소" value={place} onChangeText={setPlace} />
              <Button label="변경 저장" onPress={() => void save()} />
              <Button
                label="행사 취소"
                variant="secondary"
                onPress={() => void api.updateEvent(groupId, eventId, { status: 'CANCELLED' }).then(setEvent)}
              />
            </>
          ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
