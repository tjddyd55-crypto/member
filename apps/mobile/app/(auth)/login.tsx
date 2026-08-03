import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppBar, Button, Screen, TextField } from '../../src/design-system/components';
import { useAuth } from '../../src/auth/AuthProvider';
import { theme } from '../../src/theme';

export default function LoginScreen() {
  const { login, user, membership } = useAuth();
  const [identifier, setIdentifier] = useState('01000001003');
  const [password, setPassword] = useState('Passw0rd!');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user && membership?.status === 'ACTIVE') {
    return <Redirect href="/(app)/(tabs)/home" />;
  }
  if (user && membership?.status === 'PENDING') {
    return <Redirect href="/(auth)/join/pending" />;
  }

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <AppBar title="로그인" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>전자 회원수첩</Text>
            <Text style={styles.sub}>소속 로컬 계정으로 로그인하세요</Text>
            <TextField
              label="휴대폰 또는 이메일"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              keyboardType="default"
            />
            <TextField
              label="비밀번호"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="로그인" onPress={onSubmit} loading={loading} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.layout.horizontalGutter,
    gap: theme.space[16],
    paddingBottom: theme.space[32],
  },
  title: { ...theme.typography.display, color: theme.colors.primary.default },
  sub: { ...theme.typography.body, color: theme.colors.text.secondary, marginBottom: theme.space[8] },
  error: { ...theme.typography.bodySmall, color: theme.colors.status.error },
});
