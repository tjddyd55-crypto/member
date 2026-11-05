import { useEffect, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { shouldKeepPendingInvite } from '@member/gathering-domain';
import { ApiError, api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { DIRECTORY_CONSENT } from '../../src/copy';
import { Body, Button, ErrorState, LoadingState, Notice, Screen, Title } from '../../src/design/ui';
import { inviteStorage } from '../../src/storage/secure';

export default function InviteScreen() {
  const params = useLocalSearchParams<{ token: string }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const { user, profile } = useAuth();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user) {
      void inviteStorage.save(token);
      return;
    }
    if (!token) {
      setStatus('error');
      setMessage('초대 코드가 없습니다.');
      return;
    }
    void api
      .previewInvite(token)
      .then((preview) => {
        setGroupName(preview.groupName);
        setRequiresApproval(preview.requiresApproval);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        void forgetPendingInvite('preview-failed');
        setMessage(error instanceof Error ? error.message : '초대를 확인하지 못했습니다.');
        setStatus('error');
      });
  }, [token, user]);

  if (!user) return <Redirect href="/(auth)/login" />;

  async function forgetPendingInvite(outcome: Parameters<typeof shouldKeepPendingInvite>[0]) {
    if (!shouldKeepPendingInvite(outcome)) await inviteStorage.clear();
  }

  const accept = async () => {
    if (!profile) {
      router.push('/(app)/profile');
      return;
    }
    setJoining(true);
    try {
      const result = await api.acceptInvite(token);
      await forgetPendingInvite('accepted');
      if (result.status === 'PENDING') {
        router.replace('/(app)/groups');
        return;
      }
      router.replace(`/(app)/groups/${result.groupId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PROFILE_REQUIRED') {
        await forgetPendingInvite('profile-required');
        router.push('/(app)/profile');
        return;
      }
      await forgetPendingInvite('accept-failed');
      setMessage(error instanceof Error ? error.message : '참여하지 못했습니다.');
      setStatus('error');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Screen>
      <Title>모임 참여</Title>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? (
        <ErrorState message={message} onRetry={() => router.replace(`/invite/${token}`)} />
      ) : null}
      {status === 'ready' ? (
        <>
          <Body>{groupName ?? ''}에 참여합니다.</Body>
          <Notice>{DIRECTORY_CONSENT}</Notice>
          {requiresApproval ? (
            <Notice>이 모임은 회장 또는 총무의 승인이 있어야 들어갑니다.</Notice>
          ) : null}
          <Button label="동의하고 참여" onPress={() => void accept()} loading={joining} />
        </>
      ) : null}
      <Button
        label="내 모임으로"
        variant="text"
        onPress={() => {
          void forgetPendingInvite('dismissed').then(() => router.replace('/(app)/groups'));
        }}
      />
    </Screen>
  );
}
