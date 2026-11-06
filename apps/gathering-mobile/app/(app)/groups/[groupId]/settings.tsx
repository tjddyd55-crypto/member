import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringFinanceSummary, GatheringGroupDetail } from '@member/contracts';
import { api } from '../../../../src/api/client';
import { DateTimeField } from '../../../../src/design/pickers';
import { Body, Button, ErrorState, LoadingState, Notice, Screen, Title } from '../../../../src/design/ui';
import { dateForMonthDay, fiscalMonthDay, formatKoreanDate } from '../../../../src/features/forms/values';

function formatRange(startsAt: string, endsAt: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Seoul', dateStyle: 'long' };
  return `${new Date(startsAt).toLocaleDateString('ko-KR', options)} ~ ${new Date(endsAt).toLocaleDateString('ko-KR', options)}`;
}

export default function GroupSettingsScreen() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const [group, setGroup] = useState<GatheringGroupDetail | null>(null);
  const [summary, setSummary] = useState<GatheringFinanceSummary | null>(null);
  const [start, setStart] = useState(() => dateForMonthDay(1, 1));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async (year?: number) => {
    setStatus('loading');
    try {
      const [nextGroup, nextSummary] = await Promise.all([api.group(groupId), api.finance(groupId, year)]);
      setGroup(nextGroup);
      setSummary(nextSummary);
      setStart(dateForMonthDay(nextGroup.fiscalStartMonth, nextGroup.fiscalStartDay));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '설정을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePeriod = async () => {
    setMessage('');
    try {
      const period = fiscalMonthDay(start);
      const next = await api.updateGroup(groupId, period);
      setGroup(next);
      await load(summary?.year);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '회계 기간을 바꾸지 못했습니다.');
    }
  };

  const canSettings = group?.permissions.includes('GROUP_SETTINGS') ?? false;
  const selected = summary?.years.find((item) => item.year === summary.year) ?? null;

  return (
    <Screen>
      <Button label="모임으로" variant="text" onPress={() => router.back()} />
      <Title>모임 설정</Title>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && group && summary && selected ? (
        <>
          <Body>{`회계 시작 ${group.fiscalStartMonth}월 ${group.fiscalStartDay}일. 끝은 다음 시작 전날입니다.`}</Body>
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
          {canSettings && summary.status === 'OPEN' ? (
            <>
              <DateTimeField label="회계 시작일" mode="date" value={start} onChange={setStart} />
              <Body>{`고른 ${formatKoreanDate(start)}에서 월과 일만 회계 시작으로 저장합니다.`}</Body>
              <Button label="회계 시작일 저장" onPress={() => void savePeriod()} />
              <Body>거래, 회비, 영수증이 있으면 이 해의 기간은 바뀌지 않습니다. 지난 해 기록은 그대로 둡니다.</Body>
            </>
          ) : (
            <Body>{summary.status === 'CLOSED' ? '마감된 해는 기간을 바꾸지 않습니다.' : '회계 시작일은 회장만 바꿉니다.'}</Body>
          )}
          {message ? <Notice>{message}</Notice> : null}
        </>
      ) : null}
    </Screen>
  );
}
