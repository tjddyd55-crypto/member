import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  Screen,
  TextField,
} from '../../../../src/design/ui';
import { visibleRoleLabels } from '../../../../src/copy';
import { tabIconSize, tabLabelSize } from '../../../../src/features/group/tab-layout';
import { handoverInProgress } from '../../../../src/features/media/upload-block';
import { theme } from '../../../../src/theme';

type Tab = 'home' | 'members' | 'schedule' | 'photos' | 'finance';

const TABS: Array<{ id: Tab; label: string; icon: ComponentProps<typeof Ionicons>['name'] }> = [
  { id: 'home', label: '홈', icon: 'home' },
  { id: 'members', label: '회원', icon: 'people' },
  { id: 'schedule', label: '일정', icon: 'calendar' },
  { id: 'photos', label: '사진', icon: 'images' },
  { id: 'finance', label: '재무', icon: 'wallet' },
];

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const { width } = useWindowDimensions();
  const labelSize = tabLabelSize(width);
  const iconSize = tabIconSize(width);
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
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && group ? (
        <>
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
                  <Ionicons name={item.icon} size={iconSize} color={selected ? '#FFFFFF' : '#1B3A6B'} />
                  <Text style={[styles.tabLabel, { fontSize: labelSize }, selected && styles.tabOnText]} numberOfLines={1}>
                    {item.label}
                  </Text>
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
  const [handoverPrompt, setHandoverPrompt] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState('다음 행사 없음');
  const [recentEvent, setRecentEvent] = useState('최근 행사 없음');
  const [recentPhotos, setRecentPhotos] = useState('최근 사진 없음');
  const [money, setMoney] = useState('');

  useEffect(() => {
    void api
      .handover(group.id)
      .then((view) => {
        if (view.actions.accept) setHandoverPrompt('차기 협의회장으로 지명되었습니다. 인계를 확인해 주세요.');
        else if (handoverInProgress(view.handover?.status)) setHandoverPrompt('진행 중인 인계가 있습니다.');
        else if (view.actions.nominate) setHandoverPrompt(null);
        else setHandoverPrompt(null);
      })
      .catch(() => setHandoverPrompt(null));
  }, [group.id]);

  useEffect(() => {
    const now = Date.now();
    const span = 400 * 24 * 60 * 60 * 1000;
    const nowIso = new Date(now).toISOString();
    void Promise.all([
      api.events(group.id, nowIso, new Date(now + span).toISOString(), { order: 'asc', status: 'SCHEDULED' }),
      api.events(group.id, new Date(now - span).toISOString(), nowIso, { order: 'desc', status: 'SCHEDULED' }),
    ]).then(([upcoming, past]) => {
      setNextEvent(upcoming.items[0]?.title ?? '다음 행사 없음');
      setRecentEvent(past.items[0]?.title ?? '최근 행사 없음');
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
        <Body>{visibleRoleLabels(group.roles)}</Body>
        <Body>활동 회원 {group.memberCount}명</Body>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>다음 행사</Text>
        <Body>{nextEvent}</Body>
      </View>
      <View style={styles.cardQuiet}>
        <Text style={styles.meta}>최근 행사</Text>
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
            {visibleRoleLabels(member.roles)}
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
  tabs: { flexDirection: 'row', flexWrap: 'nowrap', width: '100%' },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: theme.space[4],
    borderRadius: theme.radius[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: '#1B3A6B' },
  tabLabel: { lineHeight: 16, textAlign: 'center', color: '#1B3A6B' },
  tabOnText: { color: '#FFFFFF' },
  stack: { gap: theme.space[12] },
  card: {
    gap: theme.space[8],
    padding: theme.space[16],
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
  },
  cardQuiet: {
    gap: theme.space[4],
    paddingVertical: theme.space[8],
    paddingHorizontal: theme.space[16],
  },
  row: { flexDirection: 'row', gap: theme.space[8], alignItems: 'center' },
  name: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
