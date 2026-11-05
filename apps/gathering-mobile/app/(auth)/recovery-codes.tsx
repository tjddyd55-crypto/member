import { Redirect, router } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { Button, Notice, Screen, Title } from '../../src/design/ui';
import { recoveryReveal } from '../../src/session/recovery-reveal';
import { theme } from '../../src/theme';

export default function RecoveryCodesScreen() {
  const { user } = useAuth();
  const codes = recoveryReveal.read();

  if (!user) return <Redirect href="/(auth)/login" />;

  const done = () => {
    recoveryReveal.clear();
    router.replace('/');
  };

  return (
    <Screen>
      <Title>복구 코드</Title>
      <Notice>
        이 코드는 지금만 보여 줍니다. 비밀번호를 잊으면 이 코드가 있어야 계정을 되찾을 수 있습니다.
        앱은 코드를 다시 보여 주지 않습니다.
      </Notice>
      {codes ? (
        codes.map((code) => (
          <Text
            key={code}
            style={{ ...theme.typography.sectionTitle, color: theme.colors.text.primary }}
            selectable
          >
            {code}
          </Text>
        ))
      ) : (
        <Notice>
          이미 화면을 닫았거나 코드를 확인 완료로 표시했습니다. 다시 표시할 수 없습니다.
        </Notice>
      )}
      <Button label="코드를 따로 적었습니다" onPress={done} />
    </Screen>
  );
}
