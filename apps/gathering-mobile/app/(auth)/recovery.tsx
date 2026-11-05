import { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { gatheringRecoveryRedeemSchema } from '@member/contracts';
import { api } from '../../src/api/client';
import { IDENTITY_LIMITATION } from '../../src/copy';
import { Body, Button, Notice, Screen, TextField, Title } from '../../src/design/ui';
import { theme } from '../../src/theme';

export default function RecoveryScreen() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redeem = async () => {
    setError(null);
    setMessage(null);
    const parsed = gatheringRecoveryRedeemSchema.safeParse({
      phone,
      recoveryCode: code,
      newPassword: password,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '입력값을 확인하세요.');
      return;
    }
    setLoading(true);
    try {
      await api.redeemRecovery(parsed.data);
      setMessage('비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '복구에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const requestReview = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await api.requestRecovery({ phone, note });
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '요청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>계정 복구</Title>
      <Notice>{IDENTITY_LIMITATION}</Notice>
      <TextField
        label="휴대폰 번호"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Body>복구 코드가 있으면 새 비밀번호로 바꿉니다.</Body>
      <TextField
        label="복구 코드"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
      />
      <TextField label="새 비밀번호" value={password} onChangeText={setPassword} secureTextEntry />
      <Button label="코드로 비밀번호 변경" onPress={() => void redeem()} loading={loading} />
      <Body>코드가 없으면 운영자 검토만 요청할 수 있습니다. 비밀번호는 바로 바뀌지 않습니다.</Body>
      <TextField label="연락 메모" value={note} onChangeText={setNote} />
      <Button label="검토 요청" variant="secondary" onPress={() => void requestReview()} />
      {message ? <Text style={{ color: theme.colors.text.primary }}>{message}</Text> : null}
      {error ? <Text style={{ color: theme.colors.status.error }}>{error}</Text> : null}
      <Button label="로그인으로" variant="text" onPress={() => router.replace('/(auth)/login')} />
    </Screen>
  );
}
