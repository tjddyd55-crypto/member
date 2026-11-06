import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../../../../src/api/client';
import { EventFinancePane } from '../../../../../src/features/finance/FinancePanes';
import { MediaPane } from '../../../../../src/features/media/MediaPane';
import { AddressField, DateTimeField } from '../../../../../src/design/pickers';
import { Body, Button, ErrorState, LoadingState, Screen, TextField, Title } from '../../../../../src/design/ui';
import { UploadLinkPanel } from '../../../../../src/features/media/UploadLinkPanel';
import { eventStartsAt } from '../../../../../src/features/forms/values';
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
  const [formError, setFormError] = useState('');
  const [place, setPlace] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(() => new Date());
  const [canManage, setCanManage] = useState(false);
  const [canFinance, setCanFinance] = useState(false);
  const [canReceipt, setCanReceipt] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [next, group] = await Promise.all([api.event(groupId, eventId), api.group(groupId)]);
      setEvent(next);
      setTitle(next.title);
      setPlace(next.place ?? '');
      const starts = new Date(next.startsAt);
      if (!Number.isNaN(starts.getTime())) {
        setDate(starts);
        setTime(starts);
      }
      setCanManage(group.permissions.includes('EVENT_MANAGE'));
      setCanFinance(group.permissions.includes('FINANCE_WRITE'));
      setCanReceipt(group.permissions.includes('RECEIPT_WRITE'));
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
    setFormError('');
    const startsAt = eventStartsAt(date, time);
    if (!startsAt) {
      setFormError('날짜와 시간을 다시 고르세요.');
      return;
    }
    if (place.length > 120) {
      setFormError('장소는 120자 안으로 줄여 주세요.');
      return;
    }
    try {
      const updated = await api.updateEvent(groupId, eventId, { title, startsAt, place });
      setEvent(updated);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '행사를 바꾸지 못했습니다.');
    }
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
          {tab === 'media' ? (
            <>
              {canManage ? <UploadLinkPanel groupId={groupId} eventId={eventId} /> : null}
              <MediaPane eventId={eventId} groupId={groupId} />
            </>
          ) : null}
          {tab === 'finance' ? (
            <EventFinancePane
              canAttach={canReceipt}
              canWrite={canFinance}
              eventId={eventId}
              groupId={groupId}
            />
          ) : null}
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
              <DateTimeField label="날짜" mode="date" value={date} onChange={setDate} />
              <DateTimeField label="시작 시간" mode="time" value={time} onChange={setTime} />
              <AddressField label="장소" value={place} onChange={setPlace} />
              {formError ? <Body>{formError}</Body> : null}
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
