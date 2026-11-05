import { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringInviteView, GatheringMemberView } from '@member/contracts';
import { api } from '../../../../src/api/client';
import { Body, Button, ErrorState, LoadingState, Notice, Screen, Title } from '../../../../src/design/ui';
import { theme } from '../../../../src/theme';

function inviteState(invite: GatheringInviteView) {
  if (invite.revokedAt) return '폐기됨';
  if (new Date(invite.expiresAt).getTime() < Date.now()) return '만료됨';
  return `사용 ${invite.useCount}회`;
}

export default function ManageScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [canInvite, setCanInvite] = useState(false);
  const [canSettings, setCanSettings] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [approval, setApproval] = useState(false);
  const [invites, setInvites] = useState<GatheringInviteView[]>([]);
  const [pending, setPending] = useState<GatheringMemberView[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const group = await api.group(groupId);
      const inviteAllowed = group.permissions.includes('INVITE_MANAGE');
      const settings = group.permissions.includes('GROUP_SETTINGS');
      const members = group.permissions.includes('MEMBER_MANAGE');
      setCanInvite(inviteAllowed);
      setCanSettings(settings);
      setCanManage(members);
      setApproval(group.inviteRequiresApproval);
      if (inviteAllowed) setInvites((await api.invites(groupId)).items);
      if (members) setPending((await api.members(groupId, 'PENDING')).items);
      setStatus('ready');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '관리 화면을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvite = async () => {
    setError(null);
    setCopied(false);
    try {
      const created = await api.createInvite(groupId);
      setLink(created.link);
      const listed = await api.invites(groupId);
      setInvites(listed.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '초대 링크를 만들지 못했습니다.');
    }
  };

  const copyLink = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
  };

  const shareLink = async () => {
    if (!link) return;
    await Share.share({ message: `모임 초대 링크입니다.\n${link}`, title: '모임 초대' });
  };

  return (
    <Screen>
      <Title>관리</Title>
      <Button label="모임으로" variant="text" onPress={() => router.replace(`/(app)/groups/${groupId}`)} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' ? (
        <View style={{ gap: theme.space[16] }}>
          <Button label="집행부" variant="secondary" onPress={() => router.push(`/(app)/groups/${groupId}/officers`)} />
          {canSettings ? (
            <Button
              label={approval ? '초대 승인 끄기' : '초대 승인 켜기'}
              variant="secondary"
              onPress={() =>
                void api.updateGroup(groupId, { inviteRequiresApproval: !approval }).then(() => setApproval(!approval))
              }
            />
          ) : null}
          {canInvite ? (
            <>
              <Button label={invites.length > 0 ? '초대 링크 다시 발급' : '초대 링크 만들기'} onPress={() => void createInvite()} />
              {link ? (
                <View style={{ gap: theme.space[8] }}>
                  <Notice>이 주소는 지금만 전체 표시됩니다. 복사하거나 공유해 두세요.</Notice>
                  <Text selectable style={{ color: theme.colors.text.primary }}>{link}</Text>
                  <Button label={copied ? '복사했습니다' : '링크 복사'} variant="secondary" onPress={() => void copyLink()} />
                  <Button label="공유 (카카오 등)" variant="secondary" onPress={() => void shareLink()} />
                </View>
              ) : null}
              {error ? <Body>{error}</Body> : null}
              <Body>발급한 링크</Body>
              {invites.length === 0 ? <Body>아직 없습니다.</Body> : null}
              {invites.map((invite) => (
                <View key={invite.id} style={{ gap: theme.space[8] }}>
                  <Text style={{ color: theme.colors.text.primary }}>
                    {new Date(invite.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 · {inviteState(invite)}
                  </Text>
                  {invite.revokedAt ? null : (
                    <Button
                      label="폐기"
                      variant="secondary"
                      onPress={() => void api.revokeInvite(groupId, invite.id).then(load)}
                    />
                  )}
                </View>
              ))}
            </>
          ) : null}
          {canManage
            ? pending.map((member) => (
                <View key={member.membershipId} style={{ gap: theme.space[8] }}>
                  <Text style={{ color: theme.colors.text.primary }}>{member.displayName} 승인 대기</Text>
                  <Button
                    label="승인"
                    onPress={() => void api.decideMember(groupId, member.membershipId, 'APPROVE').then(load)}
                  />
                  <Button
                    label="거절"
                    variant="secondary"
                    onPress={() => void api.decideMember(groupId, member.membershipId, 'REJECT').then(load)}
                  />
                </View>
              ))
            : null}
        </View>
      ) : null}
    </Screen>
  );
}
