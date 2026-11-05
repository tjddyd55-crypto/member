import { useState } from 'react';
import { router } from 'expo-router';
import { ApiError, api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthProvider';
import { Body, Button, Screen, TextField, Title } from '../../../src/design/ui';

export default function CreateGroupScreen() {
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!profile) {
      router.push('/(app)/profile');
      return;
    }
    if (name.trim().length < 1) {
      setError('모임 이름을 입력하세요.');
      return;
    }
    setLoading(true);
    try {
      const group = await api.createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      router.replace(`/(app)/groups/${group.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PROFILE_REQUIRED') {
        router.push('/(app)/profile');
        return;
      }
      setError(caught instanceof Error ? caught.message : '모임을 만들지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>모임 만들기</Title>
      <Body>모임을 만든 사람이 첫 협의회장입니다. 모임은 해가 바뀌어도 지우지 않습니다.</Body>
      <TextField label="모임 이름" value={name} onChangeText={setName} />
      <TextField label="설명" value={description} onChangeText={setDescription} />
      {error ? <Body>{error}</Body> : null}
      <Button label="만들기" onPress={() => void onSubmit()} loading={loading} />
      <Button label="취소" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
