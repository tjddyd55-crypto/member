import { useInvalidatedRefresh, useRefreshLoad } from '../../../../src/state/useInvalidatedRefresh';
import { useCallback, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import type { GatheringFinanceSummary, GatheringGroupDetail } from '@member/contracts';
import { api } from '../../../../src/api/client';
import { Body, Button, ErrorState, LoadingState, Notice, Screen, Title } from '../../../../src/design/ui';

function formatRange(startsAt: string, endsAt: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Seoul', dateStyle: 'long' };
  return `${new Date(startsAt).toLocaleDateString('ko-KR', options)} ~ ${new Date(endsAt).toLocaleDateString('ko-KR', options)}`;
}

export default function GroupSettingsScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [group, setGroup] = useState<GatheringGroupDetail | null>(null);
  const [summary, setSummary] = useState<GatheringFinanceSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const selectedYear = useRef<number | undefined>(undefined);
  const read = useCallback(async (year?: number) => {
    if (year !== undefined) selectedYear.current = year;
    setMessage('');
    setStatus('loading');
    try {
      const [nextGroup, nextSummary] = await Promise.all([api.group(groupId), api.finance(groupId, selectedYear.current)]);
      setGroup(nextGroup);
      setSummary(nextSummary);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '설정을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  const load = useRefreshLoad(read);
  useInvalidatedRefresh(groupId, 'finance', load);

  const selected = summary?.years.find((item) => item.year === summary.year) ?? null;

  return (
    <Screen>
      <Title>모임 설정</Title>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && group && summary && selected ? (
        <>
          <Body>회계연도는 매년 1월 1일부터 12월 31일까지입니다 (자동).</Body>
          <Notice>{`${selected.year} 회계연도 ${selected.status === 'CLOSED' ? '마감' : '열림'}`}</Notice>
          <Notice>{formatRange(selected.startsAt, selected.endsAt)}</Notice>
          <Body>볼 회계연도</Body>
          {summary.years.map((item) => (
            <Button
              key={item.year}
              label={item.year === summary.year ? `${item.year} 보는 중` : `${item.year}`}
              variant={item.year === summary.year ? 'primary' : 'secondary'}
              onPress={() => void load(item.year)}
            />
          ))}
          {message ? <Notice>{message}</Notice> : null}
        </>
      ) : null}
    </Screen>
  );
}
