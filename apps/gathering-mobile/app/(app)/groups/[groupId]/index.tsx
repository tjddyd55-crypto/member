import { useInvalidatedRefresh, useRefreshLoad } from '../../../../src/state/useInvalidatedRefresh';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import type {
  GatheringEventView,
  GatheringOfficerView,
  GatheringGroupDetail,
  GatheringMemberView,
} from '@member/contracts';
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
import { roleLabel, visibleRoleLabels } from '../../../../src/copy';
import { tabIconSize, tabLabelSize } from '../../../../src/features/group/tab-layout';
import { formatEventDateTime } from '../../../../src/features/schedule/range';
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
    <Screen
      scroll={tab !== 'schedule'}
      scrollKey={tab}
      footer={
        <View style={styles.tabs}>
          {TABS.map((item) => {
            const selected = tab === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => setTab(item.id)}
                style={[styles.tab, selected && styles.tabOn]}
              >
                <Ionicons
                  name={item.icon}
                  size={iconSize}
                  color={selected ? '#FFFFFF' : '#1B3A6B'}
                />
                <Text
                  style={[styles.tabLabel, { fontSize: labelSize }, selected && styles.tabOnText]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      }
    >
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && group ? (
        <>
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
  const [nextEvent, setNextEvent] = useState<GatheringEventView | null>(null);
  const [officers, setOfficers] = useState<GatheringOfficerView[]>([]);
  const [error, setError] = useState('');
  const readHome = useCallback(async () => {
    setError('');
    await Promise.all([
      api
        .events(group.id, new Date().toISOString(), '9999-12-31T23:59:59.999Z', {
          order: 'asc',
          status: 'SCHEDULED',
        })
        .then((page) => setNextEvent(page.items[0] ?? null))
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : '일정을 불러오지 못했습니다.'),
        ),
      api
        .officers(group.id)
        .then((result) => setOfficers(result.current.filter((item) => item.role !== 'PRESIDENT')))
        .catch(() => setOfficers([])),
    ]);
  }, [group.id]);
  const refreshHome = useRefreshLoad(readHome);
  useInvalidatedRefresh(group.id, 'all', refreshHome);
  return (
    <View style={styles.stack}>
      <Text style={styles.meta}>{group.name}</Text>
      <Text style={styles.name}>협의회장: {group.president?.displayName ?? '미정'}</Text>
      {officers.length ? (
        <View style={styles.card}>
          <Text style={styles.name}>임원진</Text>
          {officers.map((officer) => (
            <Body key={officer.assignmentId}>
              {roleLabel(officer.role, officer.title)} · {officer.displayName}
            </Body>
          ))}
        </View>
      ) : null}
      <Text style={styles.name}>다음 행사</Text>
      {error ? (
        <ErrorState message={error} onRetry={() => void refreshHome()} />
      ) : nextEvent ? (
        <Pressable
          accessibilityRole="button"
          style={styles.card}
          onPress={() => router.push(`/(app)/groups/${group.id}/events/${nextEvent.id}`)}
        >
          <Body>{formatEventDateTime(nextEvent.startsAt)}</Body>
          <Text style={styles.name}>{nextEvent.title}</Text>
        </Pressable>
      ) : (
        <Body>예정된 행사가 없습니다</Body>
      )}
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
    void api
      .me()
      .then((me) => setSelfId(me.user.id))
      .catch(() => setSelfId(null));
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
          <Text style={styles.meta}>{visibleRoleLabels(member.roles)}</Text>
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
  tabs: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    width: '100%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.default,
    backgroundColor: theme.colors.bg.default,
  },
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
