import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { gatheringRegisterSchema } from '@member/contracts';
import { useAuth } from '../../src/auth/AuthProvider';
import { DIRECTORY_CONSENT, IDENTITY_LIMITATION } from '../../src/copy';
import { Body, Button, Disclaimer, Notice, Screen, TextField, Title } from '../../src/design/ui';
import { theme } from '../../src/theme';

export default function RegisterScreen() {
  const { user, register } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [localJcName, setLocalJcName] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Redirect href="/" />;

  const onSubmit = async () => {
    setError(null);
    const parsed = gatheringRegisterSchema.safeParse({
      name,
      phone,
      password,
      localJcName,
      directoryConsent: consent ? true : false,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      await register(parsed.data);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>계정 만들기</Title>
      <Notice>{IDENTITY_LIMITATION}</Notice>
      <TextField label="이름" value={name} onChangeText={setName} />
      <TextField
        label="휴대폰 번호"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <TextField
        label="소속 로컬"
        value={localJcName}
        onChangeText={setLocalJcName}
        placeholder="예: 서울 ○○"
      />
      <TextField label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent((value) => !value)}
      >
        <Text style={{ color: theme.colors.text.primary }}>
          {consent ? '☑' : '☐'} {DIRECTORY_CONSENT}
        </Text>
      </Pressable>
      {error ? <Body>{error}</Body> : null}
      <Button label="가입하고 복구 코드 받기" onPress={() => void onSubmit()} loading={loading} />
      <Button label="로그인으로" variant="text" onPress={() => router.back()} />
      <Disclaimer />
    </Screen>
  );
}
