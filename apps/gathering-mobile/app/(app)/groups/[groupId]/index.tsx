import { useInvalidatedRefresh, useRefreshLoad } from '../../../../src/state/useInvalidatedRefresh';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  BackHandler,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { EventScheduleRow } from '../../../../src/features/schedule/EventScheduleRow';
import { ManualMemberSheet } from '../../../../src/features/group/ManualMemberSheet';
import { LinkMemberSheet } from '../../../../src/features/group/LinkMemberSheet';
import { useAppAlert } from '../../../../src/design/dialog';
import { CompactMemberRow } from '../../../../src/features/group/CompactMemberRow';
import {
  MemberPickerSheet,
  type AssignableRole,
} from '../../../../src/features/group/MemberPickerSheet';
import { RoleChooserSheet } from '../../../../src/features/group/RoleChooserSheet';
import { useToast } from '../../../../src/design/toast';
import { phoneDigits } from '../../../../src/utils/phone';
import { theme } from '../../../../src/theme';

import { DocumentsPane } from '../../../../src/features/documents/DocumentsPane';

type Tab = 'home' | 'members' | 'schedule' | 'photos' | 'finance' | 'documents';

const TABS: Array<{ id: Tab; label: string; icon: ComponentProps<typeof Ionicons>['name'] }> = [
  { id: 'home', label: '홈', icon: 'home' },
  { id: 'members', label: '회원', icon: 'people' },
  { id: 'schedule', label: '일정', icon: 'calendar' },
  { id: 'photos', label: '사진', icon: 'images' },
  { id: 'documents', label: '자료실', icon: 'folder' },
  { id: 'finance', label: '회계', icon: 'wallet' },
];

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ groupId: string; view?: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const { width } = useWindowDimensions();
  const labelSize = tabLabelSize(width);
  const iconSize = tabIconSize(width);
  const [tab, setTab] = useState<Tab>('home');
  useEffect(() => {
    setTab(TABS.find((item) => item.id === params.view)?.id ?? 'home');
  }, [params.view, groupId]);
  const [group, setGroup] = useState<GatheringGroupDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useFocusEffect(useCallback(() => {
    // A menu reset leaves no native history. Consume back while this screen is focused.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace('/(app)/groups');
      return true;
    });
    return () => subscription.remove();
  }, []));

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
          {tab === 'members' ? (
            <MembersPane
              groupId={group.id}
              canManage={group.permissions.includes('MEMBER_MANAGE')}
              onGroupChange={setGroup}
            />
          ) : null}
          {tab === 'schedule' ? (
            <EventsPane groupId={group.id} canManage={group.permissions.includes('EVENT_MANAGE')} />
          ) : null}
          {tab === 'documents' ? <DocumentsPane groupId={group.id} /> : null}
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
      <View style={styles.card}>
        <Text style={styles.name}>집행부</Text>
        <Body>협의회장 · {group.president?.displayName ?? '미정'}</Body>
        {officers.map((officer) => (
          <Body key={officer.assignmentId}>
            {roleLabel(officer.role, officer.title)} · {officer.displayName}
          </Body>
        ))}
      </View>
      <Text style={styles.name}>다음 행사</Text>
      {error ? (
        <ErrorState message={error} onRetry={() => void refreshHome()} />
      ) : nextEvent ? (
        <EventScheduleRow event={nextEvent} />
      ) : (
        <Body>예정된 행사가 없습니다</Body>
      )}
    </View>
  );
}

function MembersPane({
  groupId,
  canManage,
  onGroupChange,
}: {
  groupId: string;
  canManage: boolean;
  onGroupChange: (group: GatheringGroupDetail) => void;
}) {
  const { alert, dialog } = useAppAlert();
  const [manualForm, setManualForm] = useState<{ member: GatheringMemberView | null } | null>(null);
  const [linkMember, setLinkMember] = useState<GatheringMemberView | null>(null);
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
        onGroupChange(group);
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
    [groupId, onGroupChange],
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

  const confirmDelete = (member: GatheringMemberView) => {
    setMemberMenu(null);
    alert('회원 삭제', `${member.displayName}님을 회원 명부에서 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          setBlockError(null);
          void api
            .deleteManualMember(groupId, member.membershipId)
            .then(() => load(query))
            .catch((error: unknown) =>
              setBlockError(error instanceof Error ? error.message : '회원을 삭제하지 못했습니다.'),
            );
        },
      },
    ]);
  };

  return (
    <View style={styles.stack}>
      {canManage ? (
        <Button
          label="+ 앱 미가입 회원 추가"
          variant="secondary"
          onPress={() => setManualForm({ member: null })}
        />
      ) : null}
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
          <View style={styles.contactActions}>
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
            {canAssign ||
            (!member.isAppRegistered && canManage) ||
            (member.isAppRegistered && member.userId !== selfId) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${member.displayName} 메뉴`}
                style={styles.memberMenu}
                onPress={() => setMemberMenu(member)}
              >
                <Text style={styles.memberName}>⋯</Text>
              </Pressable>
            ) : null}
          </View>
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
              membershipId: member.membershipId,
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
      {dialog}
      {manualForm ? (
        <ManualMemberSheet
          member={manualForm.member}
          canAssign={canAssign}
          onClose={() => setManualForm(null)}
          onSave={async (input) => {
            if (manualForm.member)
              await api.updateManualMember(groupId, manualForm.member.membershipId, input);
            else await api.createManualMember(groupId, input);
            setManualForm(null);
            await load(query);
            toast('저장되었습니다');
          }}
        />
      ) : null}
      {linkMember ? (
        <LinkMemberSheet
          groupId={groupId}
          member={linkMember}
          onClose={() => setLinkMember(null)}
          onLinked={async () => {
            setLinkMember(null);
            await load(query);
            toast('앱 계정을 연결했습니다');
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
              {!memberMenu.isAppRegistered && canManage ? (
                <>
                  <Button
                    label="정보 수정"
                    variant="text"
                    onPress={() => {
                      setManualForm({ member: memberMenu });
                      setMemberMenu(null);
                    }}
                  />
                  <Button
                    label="앱 계정 연결"
                    variant="text"
                    onPress={() => {
                      setLinkMember(memberMenu);
                      setMemberMenu(null);
                    }}
                  />
                  <Button
                    label="회원 삭제"
                    variant="text"
                    onPress={() => confirmDelete(memberMenu)}
                  />
                </>
              ) : null}
              {memberMenu.isAppRegistered && memberMenu.userId && memberMenu.userId !== selfId ? (
                <Button
                  label="차단"
                  variant="text"
                  onPress={() => {
                    const userId = memberMenu.userId;
                    setMemberMenu(null);
                    if (userId) void block(userId);
                  }}
                />
              ) : null}
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
  contactActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space[4],
    maxWidth: '100%',
  },
  contactButton: {
    minHeight: 44,
    paddingHorizontal: theme.space[8],
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: theme.colors.primary.soft,
  },
  contactLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.primary.default },
  memberMenu: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
