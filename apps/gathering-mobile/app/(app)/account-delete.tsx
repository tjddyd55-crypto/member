import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Notice, Screen, TextField, Title } from '../../src/design/ui';

export default function AccountDeleteScreen() {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!agreed) {
      setMessage('장부 보존과 삭제 범위에 동의해야 합니다.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.deleteAccount(password);
      setMessage(
        result.memberBookKept
          ? '모임 정보를 지웠습니다. 회원수첩 계정은 남아 있습니다.'
          : '모임 계정을 지웠습니다. 장부 금액은 모임에 남아 있습니다.',
      );
      await logout();
      router.replace('/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '계정을 지우지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>계정 삭제</Title>
      <Notice>이름, 전화번호 연결, 모임 프로필, 로그인 세션을 지웁니다. 모임의 장부, 영수증, 회계 스냅샷 금액은 남고 올린 사람 이름은 끊깁니다.</Notice>
      <Body>회장으로 있는 모임은 인계한 뒤에 떠날 수 있습니다.</Body>
      <Button
        label={agreed ? '동의함' : '장부 보존에 동의'}
        variant={agreed ? 'primary' : 'secondary'}
        onPress={() => setAgreed(true)}
      />
      <TextField label="비밀번호" value={password} onChangeText={setPassword} secureTextEntry />
      {message ? <Body>{message}</Body> : null}
      <Button label="삭제" onPress={() => void submit()} loading={loading} />
      <Button label="뒤로" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
