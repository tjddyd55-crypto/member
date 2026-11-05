import { useState } from 'react';
import { router } from 'expo-router';
import { gatheringProfileSchema } from '@member/contracts';
import { useAuth } from '../../src/auth/AuthProvider';
import { DIRECTORY_CONSENT } from '../../src/copy';
import { Body, Button, Notice, Screen, TextField, Title } from '../../src/design/ui';

export default function ProfileScreen() {
  const { profile, completeProfile } = useAuth();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [localJcName, setLocalJcName] = useState(profile?.localJcName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const parsed = gatheringProfileSchema.safeParse({ name, localJcName, directoryConsent: true });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      await completeProfile(parsed.data);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '프로필을 저장하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>모임 프로필</Title>
      {profile ? (
        <Body>
          {profile.displayName} · {profile.localJcName}
        </Body>
      ) : (
        <Body>모임에 보일 이름과 소속 로컬을 등록합니다.</Body>
      )}
      <Notice>{DIRECTORY_CONSENT}</Notice>
      {profile ? null : (
        <>
          <TextField label="이름" value={name} onChangeText={setName} />
          <TextField label="소속 로컬" value={localJcName} onChangeText={setLocalJcName} />
          {error ? <Body>{error}</Body> : null}
          <Button
            label="저장하고 복구 코드 받기"
            onPress={() => void onSubmit()}
            loading={loading}
          />
        </>
      )}
      <Button label="내 모임으로" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
