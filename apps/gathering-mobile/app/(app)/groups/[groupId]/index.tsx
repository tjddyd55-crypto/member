import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringGroupDetail, GatheringMemberView } from '@member/contracts';
import { api } from '../../../../src/api/client';
import { GroupFinancePane } from '../../../../src/features/finance/FinancePanes';
import { AlbumsPane } from '../../../../src/features/media/AlbumsPane';
import { EventsPane } from '../../../../src/features/schedule/EventsPane';
import {
  Body,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  TextField,
  Title,
} from '../../../../src/design/ui';
import { theme } from '../../../../src/theme';

type Tab = 'home' | 'members' | 'schedule' | 'photos' | 'finance';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: '홈' },
  { id: 'members', label: '회원' },
  { id: 'schedule', label: '일정' },
  { id: 'photos', label: '사진' },
  { id: 'finance', label: '재무' },
];

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [tab, setTab] = useState<Tab>('home');
  const [group, setGroup] = useState<GatheringGroupDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setGroup(await api.group(groupId));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '모임을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <Button label="내 모임" variant="text" onPress={() => router.replace('/(app)/groups')} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && group ? (
        <>
          <Title>{group.name}</Title>
          <Body>
            {group.financeYear ? `${group.financeYear.year} 회계연도` : '회계연도 없음'} · 회장{' '}
            {group.president?.displayName ?? '미정'}
          </Body>
          <View style={styles.tabs}>
            {TABS.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                onPress={() => setTab(item.id)}
                style={styles.tab}
              >
                <Text
                  style={{
                    color: tab === item.id ? theme.colors.accent : theme.colors.text.secondary,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {tab === 'home' ? <HomePane group={group} onChanged={() => void load()} /> : null}
          {tab === 'members' ? <MembersPane groupId={group.id} /> : null}
          {tab === 'schedule' ? (
            <EventsPane groupId={group.id} canManage={group.permissions.includes('EVENT_MANAGE')} />
          ) : null}
          {tab === 'photos' ? <AlbumsPane groupId={group.id} /> : null}
          {tab === 'finance' ? (
            <GroupFinancePane
              groupId={group.id}
              canWrite={group.permissions.includes('FINANCE_WRITE')}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function HomePane({ group, onChanged }: { group: GatheringGroupDetail; onChanged: () => void }) {
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [subscriptionText, setSubscriptionText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<GatheringMemberView[]>([]);
  const [handoverPrompt, setHandoverPrompt] = useState<string | null>(null);
  const canInvite = group.permissions.includes('INVITE_MANAGE');
  const canSettings = group.permissions.includes('GROUP_SETTINGS');
  const canManage = group.permissions.includes('MEMBER_MANAGE');

  useEffect(() => {
    void api.subscription(group.id).then((result) => {
      if (result.uploadsAllowed && result.expiresAt) {
        const until = new Date(result.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
        setSubscriptionText(`이용 상태: 사용할 수 있음. ${until}까지입니다.`);
        return;
      }
      setSubscriptionText('이용 기간이 끝났거나 아직 없습니다. 이미 올린 파일은 볼 수 있고, 새 사진·영상은 올릴 수 없습니다.');
    }).catch(() => setSubscriptionText(null));
  }, [group.id]);

  useEffect(() => {
    void api
      .handover(group.id)
      .then((view) => {
        if (view.actions.accept) setHandoverPrompt('차기 회장으로 지명되었습니다. 인계를 확인해 주세요.');
        else if (view.actions.confirm || view.actions.finalize || view.actions.cancel || view.actions.nominate) {
          setHandoverPrompt('진행 중인 인계가 있습니다.');
        } else setHandoverPrompt(null);
      })
      .catch(() => setHandoverPrompt(null));
  }, [group.id]);

  useEffect(() => {
    if (!canManage) return;
    void api
      .members(group.id, 'PENDING')
      .then((result) => setPending(result.items))
      .catch(() => setPending([]));
  }, [canManage, group.id]);

  const createInvite = async () => {
    setError(null);
    try {
      const created = await api.createInvite(group.id);
      setInviteLink(created.link);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '초대 링크를 만들지 못했습니다.');
    }
  };

  const toggleApproval = async () => {
    await api.updateGroup(group.id, { inviteRequiresApproval: !group.inviteRequiresApproval });
    onChanged();
  };

  return (
    <View style={styles.stack}>
      {group.description ? <Body>{group.description}</Body> : null}
      <Notice>
        {group.financeYear
          ? `회계 기간 ${formatDate(group.financeYear.startsAt)} ~ ${formatDate(group.financeYear.endsAt)}.`
          : '열린 회계연도가 없습니다.'}
      </Notice>
      {subscriptionText ? <Notice>{subscriptionText}</Notice> : null}
      <Body>내 역할: {group.roles.join(', ') || '없음'}</Body>
      <Body>활동 회원 {group.memberCount}명</Body>
      {handoverPrompt ? (
        <Button
          label={handoverPrompt}
          onPress={() => router.push(`/(app)/groups/${group.id}/handover`)}
        />
      ) : null}
      <Button
        label="집행부"
        variant="secondary"
        onPress={() => router.push(`/(app)/groups/${group.id}/officers`)}
      />
      {canSettings ? (
        <Button
          label={group.inviteRequiresApproval ? '초대 승인 끄기' : '초대 승인 켜기'}
          variant="secondary"
          onPress={() => void toggleApproval()}
        />
      ) : null}
      {canInvite ? <Button label="초대 링크 만들기" onPress={() => void createInvite()} /> : null}
      {inviteLink ? <Notice>{`한 번만 표시됩니다. ${inviteLink}`}</Notice> : null}
      {error ? <Body>{error}</Body> : null}
      {pending.map((member) => (
        <View key={member.membershipId} style={styles.row}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Button
            label="승인"
            onPress={() =>
              void api.decideMember(group.id, member.membershipId, 'APPROVE').then(onChanged)
            }
          />
          <Button
            label="거절"
            variant="secondary"
            onPress={() =>
              void api.decideMember(group.id, member.membershipId, 'REJECT').then(onChanged)
            }
          />
        </View>
      ))}
    </View>
  );
}

function MembersPane({ groupId }: { groupId: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GatheringMemberView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(
    async (q?: string) => {
      setStatus('loading');
      try {
        const result = await api.members(groupId, 'ACTIVE', q);
        setItems(result.items);
        setStatus('ready');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '명부를 불러오지 못했습니다.');
        setStatus('error');
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.stack}>
      <TextField
        label="회원 검색"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => void load(query)}
      />
      <Button label="검색" variant="secondary" onPress={() => void load(query)} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? (
        <ErrorState message={message} onRetry={() => void load(query)} />
      ) : null}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="회원이 없습니다" description="초대 링크로 회원을 받으세요." />
      ) : null}
      {items.map((member) => (
        <View key={member.membershipId} style={styles.card}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Text style={styles.meta}>{member.localJcName || '소속 없음'}</Text>
          <Text style={styles.meta}>
            {member.roles.map((role) => role.title || role.role).join(', ')}
          </Text>
          {member.phone ? (
            <View style={styles.row}>
              <Button
                label="전화"
                variant="secondary"
                onPress={() => void Linking.openURL(`tel:${member.phone}`)}
              />
              <Button
                label="문자"
                variant="secondary"
                onPress={() => void Linking.openURL(`sms:${member.phone}`)}
              />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[12] },
  tab: { minHeight: theme.layout.touchMin, justifyContent: 'center' },
  stack: { gap: theme.space[12] },
  card: { gap: theme.space[8], paddingVertical: theme.space[8] },
  row: { flexDirection: 'row', gap: theme.space[8], alignItems: 'center' },
  name: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
