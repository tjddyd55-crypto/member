import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type {
  GatheringMemberView,
  GatheringOfficerTermView,
  GatheringOfficerView,
} from '@member/contracts';
import { api } from '../../../../src/api/client';
import { roleLabel } from '../../../../src/copy';
import { Body, FormError, Button, ErrorState, LoadingState, Screen, Title } from '../../../../src/design/ui';
import {
  MemberPickerSheet,
  officerRoles,
  type AssignableRole,
} from '../../../../src/features/group/MemberPickerSheet';
import { RoleChooserSheet } from '../../../../src/features/group/RoleChooserSheet';
import { useToast } from '../../../../src/design/toast';
import { theme } from '../../../../src/theme';

export default function OfficersScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [current, setCurrent] = useState<GatheringOfficerView[]>([]);
  const [history, setHistory] = useState<GatheringOfficerTermView[]>([]);
  const [members, setMembers] = useState<GatheringMemberView[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [canHandover, setCanHandover] = useState(false);
  const [handoverEntry, setHandoverEntry] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<AssignableRole | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const titles = [
    ...new Set(
      current.filter((item) => item.role === 'EXECUTIVE').map((item) => item.title ?? '집행부'),
    ),
  ];
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [officers, group, roster] = await Promise.all([
        api.officers(groupId),
        api.group(groupId),
        api.members(groupId),
      ]);
      setCurrent(officers.current);
      setHistory(officers.history);
      setMembers(roster.items);
      setCanAssign(group.permissions.includes('ROLE_ASSIGN'));
      setCanHandover(group.permissions.includes('HANDOVER'));
      const handover = await api.handover(groupId).catch(() => null);
      setHandoverEntry(
        Boolean(
          handover &&
          (handover.actions.accept ||
            handover.actions.confirm ||
            handover.actions.finalize ||
            handover.actions.cancel ||
            handover.actions.nominate),
        ),
      );
      setStatus('ready');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '집행부를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async (member: GatheringMemberView, role: AssignableRole) => {
    await api.assignOfficer(groupId, { userId: member.userId, role: role.role, title: role.title });
    setTarget(null);
    await load();
    toast('저장되었습니다');
  };

  return (
    <Screen>
      <Title>집행부</Title>
      <Button
        label="모임으로"
        variant="text"
        onPress={() => router.replace(`/(app)/groups/${groupId}`)}
      />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' ? (
        <>
          {[
            { role: 'PRESIDENT' as const, label: '협의회장', title: undefined },
            ...officerRoles(titles),
          ].map((row) => {
            const holders = current.filter(
              (item) =>
                item.role === row.role &&
                (row.role !== 'EXECUTIVE' || (item.title ?? '집행부') === row.title),
            );
            return (
              <View
                key={`${row.role}:${row.title ?? ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Body>{row.label}</Body>
                  {holders.length ? (
                    holders.map((officer) => (
                      <View
                        key={officer.assignmentId}
                        style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Text style={{ color: theme.colors.text.primary }}>
                          {officer.displayName}
                        </Text>
                        {canAssign && officer.role !== 'PRESIDENT' ? (
                          <Button
                            label="해임"
                            variant="text"
                            onPress={() => {
                              setError(null);
                              void api
                                .revokeOfficer(groupId, officer.assignmentId)
                                .then(async () => {
                                  await load();
                                  toast('저장되었습니다');
                                })
                                .catch((caught: unknown) =>
                                  setError(
                                    caught instanceof Error
                                      ? caught.message
                                      : '해임하지 못했습니다.',
                                  ),
                                );
                            }}
                          />
                        ) : null}
                      </View>
                    ))
                  ) : (
                    <Body>—</Body>
                  )}
                </View>
                {row.role === 'PRESIDENT' ? (
                  canHandover || handoverEntry ? (
                    <Button
                      label="인계"
                      variant="text"
                      onPress={() => router.push(`/(app)/groups/${groupId}/handover`)}
                    />
                  ) : null
                ) : canAssign ? (
                  <Button label="임명" variant="text" onPress={() => setTarget(row)} />
                ) : null}
              </View>
            );
          })}
          {canAssign ? (
            <Button label="+ 직책 추가" variant="text" onPress={() => setAdding(true)} />
          ) : null}
          {error ? <FormError>{error}</FormError> : null}
          {adding && canAssign ? (
            <RoleChooserSheet
              titles={titles}
              addOnly
              onClose={() => setAdding(false)}
              onChoose={(role) => {
                setAdding(false);
                setTarget(role);
              }}
            />
          ) : null}
          {target && canAssign ? (
            <MemberPickerSheet
              members={members}
              target={target}
              onClose={() => setTarget(null)}
              onAssign={assign}
            />
          ) : null}
          <Body>역대</Body>
          {history.map((term) => (
            <Text key={term.id} style={{ color: theme.colors.text.secondary }}>
              {term.fiscalYear} · {term.displayName} · {roleLabel(term.role, term.title)}
              {term.endedAt ? ' · 종료' : ' · 재임'}
            </Text>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
