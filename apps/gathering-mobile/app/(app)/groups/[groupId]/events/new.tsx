import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { gatheringEventWriteSchema } from '@member/contracts';
import { api } from '../../../../../src/api/client';
import { Body, Button, Screen, TextField, Title } from '../../../../../src/design/ui';
import { toIsoFromLocal } from '../../../../../src/features/schedule/range';

export default function NewEventScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const startsAt = toIsoFromLocal(date, time);
    if (!startsAt) {
      setError('날짜는 YYYY-MM-DD, 시간은 HH:mm 형식입니다.');
      return;
    }
    const parsed = gatheringEventWriteSchema.safeParse({
      title,
      startsAt,
      place: place || undefined,
      description: description || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      const event = await api.createEvent(groupId, parsed.data);
      router.replace(`/(app)/groups/${groupId}/events/${event.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '행사를 만들지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>행사 만들기</Title>
      <Body>회장과 총무만 등록할 수 있습니다. 저장하면 다른 회원에게 알림을 보냅니다.</Body>
      <TextField label="행사명" value={title} onChangeText={setTitle} />
      <TextField label="날짜" value={date} onChangeText={setDate} placeholder="2026-11-20" />
      <TextField label="시작 시간" value={time} onChangeText={setTime} placeholder="19:00" />
      <TextField label="장소" value={place} onChangeText={setPlace} />
      <TextField label="설명" value={description} onChangeText={setDescription} />
      {error ? <Body>{error}</Body> : null}
      <Button label="저장" onPress={() => void onSubmit()} loading={loading} />
      <Button label="취소" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
