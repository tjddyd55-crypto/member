import { useInvalidatedRefresh, useRefreshLoad } from '../../../../src/state/useInvalidatedRefresh';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
  FormError,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
} from '../../../../src/design/ui';
import { roleLabel } from '../../../../src/copy';
import { tabIconSize, tabLabelSize } from '../../../../src/features/group/tab-layout';
import { formatEventDateTime } from '../../../../src/features/schedule/range';
import { CompactMemberRow } from '../../../../src/features/group/CompactMemberRow';
import {
  MemberPickerSheet,
  type AssignableRole,
} from '../../../../src/features/group/MemberPickerSheet';
import { RoleChooserSheet } from '../../../../src/features/group/RoleChooserSheet';
import { useToast } from '../../../../src/design/toast';
import { phoneDigits } from '../../../../src/utils/phone';
import { theme } from '../../../../src/theme';

type Tab = 'home' | 'members' | 'schedule' | 'photos' | 'finance';

const TABS: Array<{ id: Tab; label: string; icon: ComponentProps<typeof Ionicons>['name'] }> = [
  { id: 'home', label: '홈', icon: 'home' },
  { id: 'members', label: '회원', icon: 'people' },
  { id: 'schedule', label: '일정', icon: 'calendar' },
  { id: 'photos', label: '사진', icon: 'images' },
  { id: 'finance', label: '회계', icon: 'wallet' },
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
              canAttach={group.permissions.includes('RECEIPT_WRITE')}
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
  const [canAssign, setCanAssign] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);
  const [roleMember, setRoleMember] = useState<GatheringMemberView | null>(null);
  const [target, setTarget] = useState<AssignableRole | null>(null);
  const toast = useToast();
  const [memberMenu, setMemberMenu] = useState<GatheringMemberView | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GatheringMemberView[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const requestVersion = useRef(0);
  const load = useCallback(
    async (q?: string) => {
      const version = ++requestVersion.current;
      setStatus('loading');
      try {
        const result = await api.members(groupId, 'ACTIVE', q);
        if (version !== requestVersion.current) return;
        const group = await api.group(groupId);
        if (version !== requestVersion.current) return;
        setItems(result.items);
        setCanAssign(group.permissions.includes('ROLE_ASSIGN'));
        if (group.permissions.includes('ROLE_ASSIGN')) {
          const officers = await api.officers(groupId);
          if (version !== requestVersion.current) return;
          setTitles([
            ...new Set(
              officers.current
                .filter((item) => item.role === 'EXECUTIVE')
                .map((item) => item.title ?? '집행부'),
            ),
          ]);
        }
        setStatus('ready');
      } catch (error) {
        if (version !== requestVersion.current) return;
        setMessage(error instanceof Error ? error.message : '명부를 불러오지 못했습니다.');
        setStatus('error');
      }
    },
    [groupId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(query.trim() || undefined), 300);
    return () => {
      clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [load, query]);

  useEffect(() => {
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
        onChangeText={(value) => {
          requestVersion.current += 1;
          setQuery(value);
        }}
      />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? (
        <ErrorState message={message} onRetry={() => void load(query)} />
      ) : null}
      {status === 'ready' && items.length === 0 ? <EmptyState title="회원이 없습니다" /> : null}
      {blockError ? <FormError>{blockError}</FormError> : null}
      {items.map((member) => (
        <CompactMemberRow key={member.membershipId} member={member}>
          {member.phone
            ? (['전화', '문자'] as const).map((label) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={`${member.displayName} ${label}`}
                  style={styles.contactButton}
                  onPress={() =>
                    void Linking.openURL(
                      `${label === '전화' ? 'tel' : 'sms'}:${phoneDigits(member.phone ?? '')}`,
                    )
                  }
                >
                  <Text style={styles.contactLabel}>{label}</Text>
                </Pressable>
              ))
            : null}
          {member.userId === selfId && !canAssign ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${member.displayName} 메뉴`}
              style={styles.memberMenu}
              onPress={() => setMemberMenu(member)}
            >
              <Text style={styles.memberName}>⋯</Text>
            </Pressable>
          )}
        </CompactMemberRow>
      ))}
      {roleMember && !target && canAssign ? (
        <RoleChooserSheet
          titles={titles}
          onClose={() => setRoleMember(null)}
          onChoose={setTarget}
        />
      ) : null}
      {roleMember && target && canAssign ? (
        <MemberPickerSheet
          members={items}
          fixedMember={roleMember}
          target={target}
          onClose={() => {
            setRoleMember(null);
            setTarget(null);
          }}
          onAssign={async (member, role) => {
            await api.assignOfficer(groupId, {
              userId: member.userId,
              role: role.role,
              title: role.title,
            });
            setRoleMember(null);
            setTarget(null);
            await load(query);
            toast('저장되었습니다');
          }}
        />
      ) : null}
      {memberMenu ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setMemberMenu(null)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="메뉴 닫기"
            style={styles.menuBackdrop}
            onPress={() => setMemberMenu(null)}
          >
            <View style={styles.memberActions}>
              {canAssign ? (
                <Button
                  label="직책 지정"
                  variant="text"
                  onPress={() => {
                    setRoleMember(memberMenu);
                    setTarget(null);
                    setMemberMenu(null);
                  }}
                />
              ) : null}
              <Button
                label="차단"
                variant="text"
                onPress={() => {
                  const userId = memberMenu.userId;
                  setMemberMenu(null);
                  void block(userId);
                }}
              />
              <Button label="취소" variant="text" onPress={() => setMemberMenu(null)} />
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  memberName: { fontSize: 14, fontWeight: '600', color: theme.colors.text.primary },
  contactButton: {
    minHeight: 36,
    paddingHorizontal: 7,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: theme.colors.primary.soft,
  },
  contactLabel: { fontSize: 12, color: theme.colors.primary.default },
  memberMenu: { width: 32, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  menuBackdrop: {
    flex: 1,
    padding: theme.layout.horizontalGutter,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  memberActions: { padding: 12, borderRadius: 12, backgroundColor: theme.colors.bg.default },
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
    padding: theme.space[12],
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
  },
  cardQuiet: {
    gap: theme.space[4],
    paddingVertical: theme.space[8],
    paddingHorizontal: theme.layout.horizontalGutter,
  },
  row: { flexDirection: 'row', gap: theme.space[8], alignItems: 'center' },
  name: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
