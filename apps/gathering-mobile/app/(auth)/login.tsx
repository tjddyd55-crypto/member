import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { normalizeKoreanMobile } from '@member/gathering-domain';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Disclaimer, Notice, Screen, TextField, Title } from '../../src/design/ui';
import { IDENTITY_LIMITATION } from '../../src/copy';
import { theme } from '../../src/theme';

export default function LoginScreen() {
  const { user, login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Redirect href="/" />;

  const onSubmit = async () => {
    setError(null);
    if (!normalizeKoreanMobile(phone)) {
      setError('010으로 시작하는 휴대폰 번호를 입력하세요.');
      return;
    }
    setLoading(true);
    try {
      await login(phone, password);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>로그인</Title>
      <Body>비밀번호로 들어갑니다. 문자 인증은 없습니다.</Body>
      <Notice>{IDENTITY_LIMITATION}</Notice>
      <TextField
        label="휴대폰 번호"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <TextField
        label="비밀번호"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      {error ? <Text style={{ color: theme.colors.status.error }}>{error}</Text> : null}
      <Button label="로그인" onPress={() => void onSubmit()} loading={loading} />
      <Button
        label="계정 만들기"
        variant="secondary"
        onPress={() => router.push('/(auth)/register')}
      />
      <Pressable accessibilityRole="link" onPress={() => router.push('/(auth)/recovery')}>
        <Text style={{ color: theme.colors.accent }}>비밀번호를 잊었습니다</Text>
      </Pressable>
      <Disclaimer />
    </Screen>
  );
}
