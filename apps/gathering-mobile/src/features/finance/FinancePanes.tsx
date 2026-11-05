import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import type { GatheringFinanceSummary, GatheringMemberView, GatheringReceiptView, GatheringTransactionView } from '@member/contracts';
import { summarizeLedger } from '@member/gathering-domain';
import { api } from '../../api/client';
import { DateTimeField } from '../../design/pickers';
import { Body, Button, EmptyState, ErrorState, Notice, TextField } from '../../design/ui';
import { paidAtFromCalendarDate } from '../forms/values';
import { theme } from '../../theme';
import { MediaViewer } from '../media/MediaViewer';
import { putPreparedFile } from '../media/prepare';

const WON = new Intl.NumberFormat('ko-KR');

export function GroupFinancePane({ groupId, canWrite }: { groupId: string; canWrite: boolean }) {
  const [summary, setSummary] = useState<GatheringFinanceSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'events' | 'dues'>('events');
  const [memberName, setMemberName] = useState('');
  const [matches, setMatches] = useState<GatheringMemberView[]>([]);
  const [picked, setPicked] = useState<GatheringMemberView | null>(null);
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('0');
  const [paidOn, setPaidOn] = useState<Date | null>(null);

  const load = useCallback(async (year?: number) => {
    setPaidOn(null);
    setStatus('loading');
    try {
      setSummary(await api.finance(groupId, year));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '장부를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  if (!summary) return null;
  const closed = summary.status === 'CLOSED';
  const writable = canWrite && !closed;
  const search = async () => {
    const found = await api.members(groupId, 'ACTIVE', memberName.trim());
    setMatches(found.items);
    setPicked(found.items.length === 1 ? found.items[0] : null);
    setPaidOn(null);
  };
  return (
    <View style={styles.stack}>
      <View style={styles.cards}>
        <MoneyCard label="기초잔액" value={summary.openingBalanceWon} />
        <MoneyCard label="전체 수입" value={summary.incomeWon} />
        <MoneyCard label="전체 지출" value={summary.expenseWon} />
        <MoneyCard label="현재 잔액" value={summary.balanceWon} />
      </View>
      <Body>{`행사 수입 ${WON.format(summary.eventIncomeWon)}원 · 회비 ${WON.format(summary.duesWon)}원. 회비는 행사 장부에 다시 넣지 않습니다.`}</Body>
      <View style={styles.years}>
        {summary.years.map((item) => {
          const selected = item.year === summary.year;
          return (
            <Pressable
              key={item.year}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => void load(item.year)}
              style={[styles.year, selected && styles.yearOn]}
            >
              <Text style={[styles.yearTitle, selected && styles.yearOnText]}>{item.year} 회계연도</Text>
              <Text style={[styles.yearRange, selected && styles.yearOnText]}>{fiscalRange(item.startsAt, item.endsAt)}</Text>
            </Pressable>
          );
        })}
      </View>
      {closed ? <Notice>마감된 회계연도는 조회만 됩니다.</Notice> : null}
      <View style={styles.segment}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'events' }}
          onPress={() => setTab('events')}
          style={[styles.segmentItem, tab === 'events' && styles.segmentOn]}
        >
          <Text style={[styles.segmentLabel, tab === 'events' && styles.segmentOnText]}>행사별 장부</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'dues' }}
          onPress={() => setTab('dues')}
          style={[styles.segmentItem, tab === 'dues' && styles.segmentOn]}
        >
          <Text style={[styles.segmentLabel, tab === 'dues' && styles.segmentOnText]}>회원 회비</Text>
        </Pressable>
      </View>
      {tab === 'events' ? (
        summary.events.length === 0 ? (
          <EmptyState title="기록된 행사가 없습니다" description="행사 화면에서 수입과 지출을 남깁니다." />
        ) : (
          summary.events.map((event) => (
            <Text key={event.eventId} style={styles.line}>
              {event.title} · 수입 {WON.format(event.incomeWon)} · 지출 {WON.format(event.expenseWon)} · 순액 {WON.format(event.netWon)}
            </Text>
          ))
        )
      ) : (
        <>
          {summary.dues.length === 0 ? <EmptyState title="회비가 없습니다" description="이름으로 회원을 찾아 청구액과 납부액을 남깁니다." /> : null}
          {summary.dues.map((due) => (
            <Text key={due.id} style={styles.line}>
              {due.displayName} · {dueLabel(due.status)} · {WON.format(due.paidAmountWon)}/{WON.format(due.amountWon)}원
            </Text>
          ))}
          {writable ? (
            <>
              <TextField label="회원 이름" value={memberName} onChangeText={setMemberName} />
              <Button label="이름으로 찾기" variant="secondary" onPress={() => void search()} />
              {matches.map((member) => (
                <Button
                  key={member.userId}
                  label={picked?.userId === member.userId ? `${member.displayName} 선택됨` : member.displayName}
                  variant={picked?.userId === member.userId ? 'primary' : 'secondary'}
                  onPress={() => {
                  setPicked(member);
                  setPaidOn(null);
                }}
                />
              ))}
              <TextField label="청구액(원)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
              <TextField label="납부액(원)" value={paid} onChangeText={setPaid} keyboardType="number-pad" />
              {paidOn ? (
                <>
                  <DateTimeField label="납부일" mode="date" value={paidOn} onChange={setPaidOn} />
                  <Button label="납부일 지우기" variant="text" onPress={() => setPaidOn(null)} />
                </>
              ) : (
                <Button label="납부일 고르기" variant="secondary" onPress={() => setPaidOn(new Date())} />
              )}
              <Button
                label="회비 저장"
                onPress={() => {
                  if (!picked) {
                    setMessage('회원 이름을 찾아 선택하세요.');
                    return;
                  }
                  void api
                    .saveDue(groupId, {
                      userId: picked.userId,
                      year: summary.year,
                      amountWon: Number(amount),
                      paidAmountWon: Number(paid),
                      paidAt: paidOn ? paidAtFromCalendarDate(paidOn) : null,
                    })
                    .then(() => load(summary.year))
                    .catch((error: unknown) => setMessage(error instanceof Error ? error.message : '회비를 저장하지 못했습니다.'));
                }}
              />
            </>
          ) : null}
        </>
      )}
      {message ? <Notice>{message}</Notice> : null}
    </View>
  );
}

function MoneyCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{WON.format(value)}원</Text>
    </View>
  );
}

function fiscalRange(startsAt: string, endsAt: string) {
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' });
  return `${format(startsAt)} ~ ${format(endsAt)}`;
}

function dueLabel(status: string) {
  if (status === 'PAID') return '완납';
  if (status === 'PARTIAL') return '일부';
  if (status === 'WAIVED') return '면제';
  return '미납';
}

export function EventFinancePane({
  groupId,
  eventId,
  canWrite,
  canAttach,
}: {
  groupId: string;
  eventId: string;
  canWrite: boolean;
  canAttach: boolean;
}) {
  const [items, setItems] = useState<GatheringTransactionView[]>([]);
  const [receipts, setReceipts] = useState<GatheringReceiptView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [yearOpen, setYearOpen] = useState(true);
  const [viewer, setViewer] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [ledger, files, summary] = await Promise.all([
        api.eventTransactions(groupId, eventId),
        api.eventReceipts(groupId, eventId),
        api.finance(groupId),
      ]);
      setItems(ledger.items);
      setReceipts(files.items);
      setYearOpen(summary.status === 'OPEN');
      const images = files.items.filter((item) => item.mimeType.startsWith('image/'));
      const urls = await Promise.all(
        images.map(async (item) => {
          const download = await api.downloadReceipt(groupId, item.id);
          return [item.id, download.url] as const;
        }),
      );
      setThumbs(Object.fromEntries(urls));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '재무를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = summarizeLedger(
    0,
    items.map((item) => ({ direction: item.direction, amountWon: item.amountWon })),
  );

  const save = async () => {
    try {
      await api.createTransaction(groupId, eventId, {
        direction,
        label: label.trim(),
        amountWon: Number(amount),
        paidAt: paidAtFromCalendarDate(paidOn),
        note: note.trim() || null,
      });
      setLabel('');
      setAmount('');
      setNote('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '거래를 저장하지 못했습니다.');
    }
  };

  const attach = async () => {
    try {
      const picked = await File.pickFileAsync().catch(() => null);
      if (!picked) return;
      for (const pickedFile of Array.isArray(picked) ? picked : [picked]) {
        const file = new File(pickedFile.uri);
        if (!file.size) throw new Error('파일 크기를 확인하지 못했습니다.');
        const originalName = file.name || fileName(file.uri);
        const mimeType = receiptMime(file);
        const created = await api.createReceiptUploads(groupId, eventId, [
          { mimeType, sizeBytes: file.size, originalName },
        ]);
        const target = created.items[0];
        if (!target) continue;
        await putPreparedFile(file.uri, target.uploadUrl, target.headers, () => undefined);
        await api.completeReceipt(groupId, eventId, target.id, file.size);
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '영수증을 첨부하지 못했습니다.');
    }
  };

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <Notice>{`이 행사 수입 ${WON.format(totals.incomeWon)}원 · 지출 ${WON.format(totals.expenseWon)}원`}</Notice>
      {message ? <Notice>{message}</Notice> : null}
      {items.length === 0 ? <EmptyState title="항목이 없습니다" description="날짜는 실제 결제일입니다. 행사일과 달라도 됩니다." /> : null}
      {items.map((item) => (
        <Text key={item.id} style={styles.line}>
          {new Date(item.paidAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} · {item.direction === 'INCOME' ? '수입' : '지출'} · {item.label} · {WON.format(item.amountWon)}원
          {item.note ? ` · ${item.note}` : ''}
        </Text>
      ))}
      {canWrite && yearOpen ? (
        <>
          <View style={styles.row}>
            <Button label={direction === 'EXPENSE' ? '지출 선택됨' : '지출'} variant={direction === 'EXPENSE' ? 'primary' : 'secondary'} onPress={() => setDirection('EXPENSE')} />
            <Button label={direction === 'INCOME' ? '수입 선택됨' : '수입'} variant={direction === 'INCOME' ? 'primary' : 'secondary'} onPress={() => setDirection('INCOME')} />
          </View>
          <TextField label="항목" value={label} onChangeText={setLabel} />
          <TextField label="금액(원)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <DateTimeField label="결제일" mode="date" value={paidOn} onChange={setPaidOn} />
          <TextField label="비고" value={note} onChangeText={setNote} />
          <Button label="항목 저장" onPress={() => void save()} />
        </>
      ) : null}
      <View style={styles.row}>
        {receipts.map((receipt) => (
          <Pressable key={receipt.id} accessibilityRole="button" onPress={() => void openReceipt(groupId, receipt, thumbs[receipt.id], setViewer)}>
            {thumbs[receipt.id] ? (
              <Image source={{ uri: thumbs[receipt.id] }} style={styles.thumb} />
            ) : (
              <Text style={styles.line}>{receipt.originalName ?? '영수증'}{receipt.immutable ? ' · 보존' : ''}</Text>
            )}
          </Pressable>
        ))}
      </View>
      {canAttach && yearOpen ? <Button label="영수증 여러 장 첨부" variant="secondary" onPress={() => void attach().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '영수증을 첨부하지 못했습니다.'))} /> : null}
      {!yearOpen ? <Notice>마감된 회계연도의 영수증과 장부는 조회만 됩니다.</Notice> : null}
      {viewer ? <MediaViewer kind="PHOTO" uri={viewer} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

async function openReceipt(
  groupId: string,
  receipt: GatheringReceiptView,
  thumb: string | undefined,
  zoom: (uri: string) => void,
) {
  const file = thumb ? { url: thumb } : await api.downloadReceipt(groupId, receipt.id);
  if (receipt.mimeType.startsWith('image/')) {
    zoom(file.url);
    return;
  }
  await Linking.openURL(file.url);
}

function fileName(uri: string) {
  const part = uri.split('/').pop() ?? 'receipt';
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

function receiptMime(file: File) {
  const fromType = allowedReceiptMime(file.type);
  if (fromType) return fromType;
  const fromName = mimeFromExtension(file.extension || extensionOf(file.name));
  if (fromName) return fromName;
  throw new Error('영수증은 JPEG, PNG, WebP, PDF만 첨부할 수 있습니다.');
}

function allowedReceiptMime(mimeType: string) {
  if (mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType === 'application/pdf' || mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp') {
    return mimeType;
  }
  return null;
}

function mimeFromExtension(extension: string) {
  const normalized = extension.toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.png') return 'image/png';
  if (normalized === '.webp') return 'image/webp';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  return null;
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[12] },
  row: { gap: theme.space[8], flexDirection: 'row', flexWrap: 'wrap' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8] },
  card: {
    width: '47%',
    backgroundColor: theme.colors.bg.subtle,
    borderRadius: theme.radius[12],
    padding: theme.space[12],
    gap: theme.space[8],
  },
  cardLabel: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  cardValue: { ...theme.typography.body, color: theme.colors.text.primary },
  line: { ...theme.typography.body, color: theme.colors.text.primary },
  thumb: { width: 96, height: 96, borderRadius: theme.radius[12] },
  years: { gap: theme.space[8] },
  year: {
    minHeight: 48,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[12],
    paddingVertical: theme.space[8],
    backgroundColor: theme.colors.bg.subtle,
    gap: 2,
  },
  yearOn: { backgroundColor: '#1B3A6B' },
  yearTitle: { ...theme.typography.cardTitle, color: '#1B3A6B' },
  yearRange: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  yearOnText: { color: '#FFFFFF' },
  segment: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    borderRadius: theme.radius[12],
    overflow: 'hidden',
    backgroundColor: theme.colors.bg.subtle,
  },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: '#1B3A6B' },
  segmentLabel: { ...theme.typography.button, color: '#1B3A6B' },
  segmentOnText: { color: '#FFFFFF' },
});
