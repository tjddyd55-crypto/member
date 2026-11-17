import { useState } from 'react';
import { Alert, Keyboard, Pressable, Text } from 'react-native';
import { Redirect, router } from 'expo-router';
import { gatheringLoginSchema } from '@member/contracts';
import { normalizeKoreanMobile } from '@member/gathering-domain';
import { useAuth } from '../../src/auth/AuthProvider';
import {
  Body,
  Button,
  FormError,
  Disclaimer,
  Notice,
  Screen,
  TextField,
  Title,
} from '../../src/design/ui';
import { IDENTITY_LIMITATION } from '../../src/copy';
import { theme } from '../../src/theme';

export default function LoginScreen() {
  const { user, login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showError = (message: string) => {
    setError(message);
    Alert.alert('로그인할 수 없습니다', message);
  };

  if (user) return <Redirect href="/" />;

  const onSubmit = async () => {
    Keyboard.dismiss();
    setError(null);
    if (!normalizeKoreanMobile(phone)) {
      showError('010으로 시작하는 휴대폰 번호를 입력하세요.');
      return;
    }
    const parsed = gatheringLoginSchema.safeParse({ phone, password });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      await login(phone, password);
      router.replace('/');
    } catch (caught) {
      showError(
        caught instanceof TypeError
          ? '서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.'
          : caught instanceof Error
            ? caught.message
            : '로그인에 실패했습니다.',
      );
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
      {error ? <FormError>{error}</FormError> : null}
      <Button label="로그인" onPress={() => void onSubmit()} loading={loading} />
      <Button
        label="계정 만들기"
        variant="secondary"
        onPress={() => router.push('/(auth)/register')}
      />
      <Pressable accessibilityRole="link" onPress={() => router.push('/(auth)/recovery')}>
        <Text style={{ color: theme.colors.accent }}>비밀번호를 잊었습니다</Text>
      </Pressable>
      <Button
        label="개인정보 처리방침"
        variant="text"
        onPress={() => router.push('/(app)/legal/privacy')}
      />
      <Button label="이용약관" variant="text" onPress={() => router.push('/(app)/legal/terms')} />
      <Disclaimer />
    </Screen>
  );
}
