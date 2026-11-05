import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { gatheringEventWriteSchema } from '@member/contracts';
import { api } from '../../../../../src/api/client';
import { AddressField, DateTimeField } from '../../../../../src/design/pickers';
import { Body, Button, Screen, TextField, Title } from '../../../../../src/design/ui';
import { eventStartsAt } from '../../../../../src/features/forms/values';

function evening() {
  const time = new Date();
  time.setHours(19, 0, 0, 0);
  return time;
}

export default function NewEventScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(evening);
  const [place, setPlace] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const startsAt = eventStartsAt(date, time);
    if (!startsAt) {
      setError('날짜와 시간을 다시 고르세요.');
      return;
    }
    if (place.length > 120) {
      setError('장소는 120자 안으로 줄여 주세요.');
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
      <Body>협의회장과 총무만 등록할 수 있습니다. 저장하면 다른 회원에게 알림을 보냅니다.</Body>
      <TextField label="행사명" value={title} onChangeText={setTitle} />
      <DateTimeField label="날짜" mode="date" value={date} onChange={setDate} />
      <DateTimeField label="시작 시간" mode="time" value={time} onChange={setTime} />
      <AddressField label="장소" value={place} onChange={setPlace} />
      <TextField label="설명" value={description} onChangeText={setDescription} />
      {error ? <Body>{error}</Body> : null}
      <Button label="저장" onPress={() => void onSubmit()} loading={loading} />
      <Button label="취소" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
