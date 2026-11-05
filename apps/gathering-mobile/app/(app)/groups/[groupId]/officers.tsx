import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringMemberView, GatheringOfficerTermView, GatheringOfficerView } from '@member/contracts';
import { api } from '../../../../src/api/client';
import { ROLE_LABEL } from '../../../../src/copy';
import { Body, Button, ErrorState, LoadingState, Screen, TextField, Title } from '../../../../src/design/ui';
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
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
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

  const assign = async (role: 'SECRETARY' | 'TREASURER' | 'EXECUTIVE') => {
    setError(null);
    try {
      await api.assignOfficer(groupId, { userId, role, title: title || undefined });
      setTitle('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '역할을 지정하지 못했습니다.');
    }
  };

  return (
    <Screen>
      <Title>집행부</Title>
      <Button label="모임으로" variant="text" onPress={() => router.replace(`/(app)/groups/${groupId}`)} />
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' ? (
        <>
          <Body>현재</Body>
          {current.map((officer) => (
            <View key={officer.assignmentId} style={{ gap: 4 }}>
              <Text style={{ color: theme.colors.text.primary }}>
                {officer.displayName} · {officer.title || ROLE_LABEL[officer.role] || officer.role}
              </Text>
              {canAssign && officer.role !== 'PRESIDENT' ? (
                <Button
                  label="해임"
                  variant="secondary"
                  onPress={() => void api.revokeOfficer(groupId, officer.assignmentId).then(load)}
                />
              ) : null}
            </View>
          ))}
          {canAssign ? (
            <>
              <Body>회원 번호로 역할을 지정합니다. 회장 역할은 인계 절차에서만 바뀝니다.</Body>
              {members.map((member) => (
                <Button
                  key={member.userId}
                  label={`${member.displayName} 선택`}
                  variant={userId === member.userId ? 'primary' : 'text'}
                  onPress={() => setUserId(member.userId)}
                />
              ))}
              <TextField label="추가 집행부 직함" value={title} onChangeText={setTitle} />
              <Button label="총무 지정" onPress={() => void assign('SECRETARY')} />
              <Button label="재무 지정" variant="secondary" onPress={() => void assign('TREASURER')} />
              <Button label="추가 집행부 지정" variant="secondary" onPress={() => void assign('EXECUTIVE')} />
              {error ? <Body>{error}</Body> : null}
            </>
          ) : (
            <Body>역할 변경은 회장만 할 수 있습니다.</Body>
          )}
          {canHandover || handoverEntry ? (
            <Button label="차기 회장 인계" onPress={() => router.push(`/(app)/groups/${groupId}/handover`)} />
          ) : null}
          <Body>역대</Body>
          {history.map((term) => (
            <Text key={term.id} style={{ color: theme.colors.text.secondary }}>
              {term.fiscalYear} · {term.displayName} · {term.title || ROLE_LABEL[term.role] || term.role}
              {term.endedAt ? ' · 종료' : ' · 재임'}
            </Text>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
