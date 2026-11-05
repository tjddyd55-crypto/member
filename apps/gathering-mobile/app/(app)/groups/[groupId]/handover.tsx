import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../../../src/api/client';
import { Body, Button, ErrorState, LoadingState, Notice, Screen, TextField, Title } from '../../../../src/design/ui';

type HandoverView = Awaited<ReturnType<typeof api.handover>>;

export default function HandoverScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [view, setView] = useState<HandoverView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [nominateKey, setNominateKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setView(await api.handover(groupId));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '인계를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '인계를 진행하지 못했습니다.');
    }
  };

  return (
    <Screen>
      <Title>최종 인계</Title>
      <Button label="집행부로" variant="text" onPress={() => router.replace(`/(app)/groups/${groupId}/officers`)} />
      <Notice>최종 인계를 승인하면 이 회계연도의 장부와 영수증은 더 이상 고칠 수 없습니다. 정정은 다음 해 거래로 남깁니다.</Notice>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {message ? <Notice>{message}</Notice> : null}
      {status === 'ready' && view ? (
        <Steps
          groupId={groupId}
          view={view}
          successorId={successorId}
          nominateKey={nominateKey}
          onSuccessor={setSuccessorId}
          onNominateKey={setNominateKey}
          onRun={run}
        />
      ) : null}
    </Screen>
  );
}

function Steps({
  groupId,
  view,
  successorId,
  nominateKey,
  onSuccessor,
  onNominateKey,
  onRun,
}: {
  groupId: string;
  view: HandoverView;
  successorId: string;
  nominateKey: string | null;
  onSuccessor: (value: string) => void;
  onNominateKey: (value: string | null) => void;
  onRun: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const preview = view.preview;
  return (
    <>
      <Body>상태: {view.handover?.status ?? '아직 지명 전'}</Body>
      {preview ? (
        <Body>
          수입 {preview.incomeWon}원 · 지출 {preview.expenseWon}원 · 잔액 {preview.balanceWon}원 · 회비 {preview.dueCount}건 · 영수증 {preview.receiptCount}장
        </Body>
      ) : null}
      {view.actions.nominate ? (
        <>
          <TextField label="차기 협의회장 회원 아이디" value={successorId} onChangeText={onSuccessor} autoCapitalize="none" />
          <Button
            label="차기 협의회장 지명"
            onPress={() => {
              const key = nominateKey ?? `handover-${groupId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
              onNominateKey(key);
              void onRun(() => api.nominateHandover(groupId, successorId.trim(), key));
            }}
          />
        </>
      ) : null}
      {view.actions.accept && view.handover ? (
        <Button label="인계 수락" onPress={() => void onRun(() => api.acceptHandover(groupId, view.handover!.id))} />
      ) : null}
      {view.actions.confirm && view.handover && preview ? (
        <Button label="합계를 확인하고 다음으로" onPress={() => void onRun(() => api.confirmHandover(groupId, view.handover!.id, preview))} />
      ) : null}
      {view.actions.finalize && view.handover ? (
        <Button label="최종 인계 승인" onPress={() => void onRun(() => api.finalizeHandover(groupId, view.handover!.id))} />
      ) : null}
      {view.actions.cancel && view.handover ? (
        <Button
          label="지명 취소"
          variant="secondary"
          onPress={() => {
            onNominateKey(null);
            void onRun(() => api.cancelHandover(groupId, view.handover!.id));
          }}
        />
      ) : null}
    </>
  );
}
