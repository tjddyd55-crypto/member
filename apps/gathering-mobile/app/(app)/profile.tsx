import { Alert, Keyboard } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { gatheringProfileSchema } from '@member/contracts';
import { useAuth } from '../../src/auth/AuthProvider';
import { DIRECTORY_CONSENT } from '../../src/copy';
import { BirthDateField, SexField } from '../../src/features/forms/demographics';
import { JcOrgPicker, jcPickerValue } from '../../src/features/forms/JcOrgPicker';
import { Body, Button, FormError, Notice, Screen, TextField, Title } from '../../src/design/ui';

export default function ProfileScreen() {
  const { profile, completeProfile, logout } = useAuth();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [affiliation, setAffiliation] = useState(() => jcPickerValue(profile));
  const [birthDate, setBirthDate] = useState(profile?.birthDate ?? '');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | ''>(profile?.sex ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showError = (message: string) => {
    setError(message);
    Alert.alert('프로필을 저장할 수 없습니다', message);
  };

  const onSubmit = async () => {
    Keyboard.dismiss();
    setError(null);
    const parsed = gatheringProfileSchema.safeParse({
      name,
      localId: affiliation.local?.id,
      birthDate,
      sex,
      directoryConsent: true,
    });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      await completeProfile(parsed.data);
      router.replace('/');
    } catch (caught) {
      showError(
        caught instanceof TypeError
          ? '서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'
          : caught instanceof Error
            ? caught.message
            : '프로필을 저장하지 못했습니다.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>내 정보 및 설정</Title>
      {profile ? (
        <Body>
          {profile.displayName} · {profile.localDisplayName}
        </Body>
      ) : (
        <Body>모임에 보일 이름, 소속 로컬, 생년월일, 성별을 등록합니다.</Body>
      )}
      <Notice>{DIRECTORY_CONSENT}</Notice>
      <TextField label="이름" value={name} onChangeText={setName} />
      {profile?.affiliationNeedsReselect ? (
        <Notice>기존에 입력한 소속 “{profile.localJcName}”을(를) 조직 목록에서 찾지 못했습니다. 지구와 로컬을 다시 선택해 주세요.</Notice>
      ) : null}
      <JcOrgPicker value={affiliation} onChange={setAffiliation} />
      <BirthDateField value={birthDate} onChange={setBirthDate} />
      <SexField value={sex} onChange={setSex} />
      {error ? <FormError>{error}</FormError> : null}
      <Button
        label={profile ? '저장' : '저장하고 복구 코드 받기'}
        onPress={() => void onSubmit()}
        loading={loading}
      />
      <Button
        label="개인정보 처리방침"
        variant="text"
        onPress={() => router.push('/(app)/legal/privacy')}
      />
      <Button label="이용약관" variant="text" onPress={() => router.push('/(app)/legal/terms')} />
      <Button
        label="계정 삭제"
        variant="text"
        onPress={() => router.push('/(app)/account-delete')}
      />
      <Button label="로그아웃" variant="text" onPress={() => void logout()} />
    </Screen>
  );
}
