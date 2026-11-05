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
import { roleLabel } from '../../../../src/copy';
import { theme } from '../../../../src/theme';

type Tab = 'home' | 'members' | 'schedule' | 'photos' | 'finance';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'members', label: '회원', icon: '☺' },
  { id: 'schedule', label: '일정', icon: '▦' },
  { id: 'photos', label: '사진', icon: '▣' },
  { id: 'finance', label: '재무', icon: '₩' },
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
            {group.financeYear ? `${group.financeYear.year} 회계연도` : '회계연도 없음'} · 협의회장{' '}
            {group.president?.displayName ?? '미정'}
          </Body>
          <View style={styles.tabs}>
            {TABS.map((item) => {
              const selected = tab === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setTab(item.id)}
                  style={[styles.tab, selected && styles.tabOn]}
                >
                  <Text style={[styles.tabIcon, selected && styles.tabOnText]}>{item.icon}</Text>
                  <Text style={[styles.tabLabel, selected && styles.tabOnText]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {tab === 'home' ? <HomePane group={group} /> : null}
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

function HomePane({ group }: { group: GatheringGroupDetail }) {
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [handoverPrompt, setHandoverPrompt] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState('다음 행사 없음');
  const [recentEvent, setRecentEvent] = useState('최근 행사 없음');
  const [recentPhotos, setRecentPhotos] = useState('최근 사진 없음');
  const [money, setMoney] = useState('');

  useEffect(() => {
    void api.subscription(group.id).then((result) => {
      setUploadNote(result.uploadsAllowed ? null : '새 사진과 영상은 지금 올릴 수 없습니다. 이미 올린 파일은 볼 수 있습니다.');
    }).catch(() => setUploadNote(null));
  }, [group.id]);

  useEffect(() => {
    void api
      .handover(group.id)
      .then((view) => {
        if (view.actions.accept) setHandoverPrompt('차기 협의회장으로 지명되었습니다. 인계를 확인해 주세요.');
        else if (view.actions.confirm || view.actions.finalize || view.actions.cancel || view.actions.nominate) {
          setHandoverPrompt('진행 중인 인계가 있습니다.');
        } else setHandoverPrompt(null);
      })
      .catch(() => setHandoverPrompt(null));
  }, [group.id]);

  useEffect(() => {
    const now = Date.now();
    const span = 400 * 24 * 60 * 60 * 1000;
    const from = new Date(now - span).toISOString();
    const to = new Date(now + span).toISOString();
    void api.events(group.id, from, to).then((result) => {
      const upcoming = result.items
        .filter((item) => item.status !== 'CANCELLED' && new Date(item.startsAt).getTime() >= now)
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
      const past = result.items
        .filter((item) => new Date(item.startsAt).getTime() < now)
        .sort((left, right) => right.startsAt.localeCompare(left.startsAt));
      setNextEvent(upcoming[0] ? upcoming[0].title : '다음 행사 없음');
      setRecentEvent(past[0] ? past[0].title : '최근 행사 없음');
    }).catch(() => undefined);
    void api.albums(group.id).then((result) => {
      const album = result.events[0];
      setRecentPhotos(album ? `${album.title} · 사진 ${album.photoCount} · 영상 ${album.videoCount}` : '최근 사진 없음');
    }).catch(() => undefined);
    void api.finance(group.id).then((summary) => {
      setMoney(`기초 ${summary.openingBalanceWon.toLocaleString('ko-KR')}원 · 수입 ${summary.incomeWon.toLocaleString('ko-KR')}원 · 지출 ${summary.expenseWon.toLocaleString('ko-KR')}원 · 잔액 ${summary.balanceWon.toLocaleString('ko-KR')}원`);
    }).catch(() => undefined);
  }, [group.id]);

  return (
    <View style={styles.stack}>
      {group.description ? <Body>{group.description}</Body> : null}
      <View style={styles.card}>
        <Text style={styles.name}>내 역할</Text>
        <Body>{group.roles.map((role) => roleLabel(role)).join(', ') || '일반 회원'}</Body>
        <Body>활동 회원 {group.memberCount}명</Body>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>다음 행사</Text>
        <Body>{nextEvent}</Body>
        <Text style={styles.name}>최근 행사</Text>
        <Body>{recentEvent}</Body>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>최근 사진</Text>
        <Body>{recentPhotos}</Body>
      </View>
      {money ? (
        <View style={styles.card}>
          <Text style={styles.name}>재무 요약</Text>
          <Body>{money}</Body>
        </View>
      ) : null}
      {uploadNote ? <Notice>{uploadNote}</Notice> : null}
      {handoverPrompt ? (
        <Button
          label={handoverPrompt}
          onPress={() => router.push(`/(app)/groups/${group.id}/handover`)}
        />
      ) : null}
<Button
        label="모임 설정"
        variant="secondary"
        onPress={() => router.push(`/(app)/groups/${group.id}/settings`)}
      />
      <Button label="관리" variant="secondary" onPress={() => router.push(`/(app)/groups/${group.id}/manage`)} />
    </View>
  );
}

function MembersPane({ groupId }: { groupId: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GatheringMemberView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
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
    void api.me().then((me) => setSelfId(me.user.id)).catch(() => setSelfId(null));
  }, [load]);

  const block = async (userId: string) => {
    setBlockError(null);
    try {
      await api.blockMember(groupId, userId);
      await load(query);
    } catch (error) {
      setBlockError(error instanceof Error ? error.message : '차단하지 못했습니다.');
    }
  };

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
      {blockError ? <Body>{blockError}</Body> : null}
      {items.map((member) => (
        <View key={member.membershipId} style={styles.card}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Text style={styles.meta}>{member.localJcName || '소속 없음'}</Text>
          <Text style={styles.meta}>
            {member.roles.map((role) => roleLabel(role.role, role.title)).join(', ')}
          </Text>
          {member.userId === selfId ? null : (
            <Button label="차단" variant="text" onPress={() => void block(member.userId)} />
          )}
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

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8] },
  tab: {
    flexGrow: 1,
    flexBasis: 64,
    minHeight: 48,
    paddingHorizontal: theme.space[4],
    paddingVertical: theme.space[4],
    borderRadius: theme.radius[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: '#1B3A6B' },
  tabIcon: { fontSize: 16, color: theme.colors.text.secondary },
  tabLabel: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: theme.colors.text.secondary },
  tabOnText: { color: '#FFFFFF' },
  stack: { gap: theme.space[12] },
  card: {
    gap: theme.space[8],
    padding: theme.space[16],
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
  },
  row: { flexDirection: 'row', gap: theme.space[8], alignItems: 'center' },
  name: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
