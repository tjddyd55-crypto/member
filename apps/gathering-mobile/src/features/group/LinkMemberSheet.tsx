import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import type { GatheringMemberView } from '@member/contracts';
import { api } from '../../api/client';
import { Body, Button, LoadingState, TextField } from '../../design/ui';
import { CompactMemberRow } from './CompactMemberRow';
import { MemberActionSheet } from './ManualMemberSheet';

export function LinkMemberSheet({
  groupId,
  member,
  onClose,
  onLinked,
}: {
  groupId: string;
  member: GatheringMemberView;
  onClose: () => void;
  onLinked: () => Promise<void>;
}) {
  const [items, setItems] = useState<GatheringMemberView[] | null>(null);
  const [target, setTarget] = useState<GatheringMemberView | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    void Promise.all([api.members(groupId, 'PENDING'), api.members(groupId, 'ACTIVE')])
      .then(([pending, active]) => {
        if (mounted)
          setItems([...pending.items, ...active.items].filter((item) => item.isAppRegistered));
      })
      .catch((cause: unknown) => {
        if (mounted)
          setError(cause instanceof Error ? cause.message : '회원을 불러오지 못했습니다.');
      });
    return () => {
      mounted = false;
    };
  }, [groupId]);

  async function link() {
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.linkManualMember(groupId, member.membershipId, target.membershipId);
      await onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '계정을 연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const candidates = items?.filter((item) =>
    [item.displayName, item.localDisplayName, item.phone]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <MemberActionSheet title="앱 계정 연결" busy={busy} error={error} onClose={onClose}>
      {target ? (
        <>
          <Body>
            {member.displayName}님의 회원 기록을 {target.displayName}님의 앱 계정에 연결할까요?
          </Body>
          <Button label="연결 확인" loading={busy} onPress={() => void link()} />
          <Button
            label="다른 회원 선택"
            variant="secondary"
            disabled={busy}
            onPress={() => setTarget(null)}
          />
        </>
      ) : (
        <>
          <Body>{member.displayName}님의 기록과 연결할 회원을 선택하세요.</Body>
          <TextField label="회원 검색" value={query} onChangeText={setQuery} />
          {items === null && !error ? <LoadingState /> : null}
          {candidates?.length === 0 ? <Body>조건에 맞는 앱 가입 회원이 없습니다.</Body> : null}
          {candidates?.map((item) => (
            <Pressable
              key={item.membershipId}
              accessibilityRole="button"
              onPress={() => setTarget(item)}
            >
              <CompactMemberRow member={item}>
                {item.status === 'PENDING' ? <Body>승인 대기</Body> : null}
              </CompactMemberRow>
            </Pressable>
          ))}
        </>
      )}
    </MemberActionSheet>
  );
}
