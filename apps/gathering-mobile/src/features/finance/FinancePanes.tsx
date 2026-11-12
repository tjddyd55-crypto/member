import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import type {
  GatheringFinanceSummary,
  GatheringMemberView,
  GatheringReceiptView,
  GatheringTransactionView,
} from '@member/contracts';
import { summarizeLedger } from '@member/gathering-domain';
import { api } from '../../api/client';
import { DateTimeField } from '../../design/pickers';
import {
  Body,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  Screen,
  TextField,
} from '../../design/ui';
import { paidAtFromCalendarDate } from '../forms/values';
import { theme } from '../../theme';
import { MediaViewer } from '../media/MediaViewer';
import { prepareAsset, putPreparedFile } from '../media/prepare';
import { financeYearState, type FinanceYear } from '../events/detail';

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
  startsAt,
  active = true,
}: {
  groupId: string;
  eventId: string;
  canWrite: boolean;
  canAttach: boolean;
  startsAt: string;
  active?: boolean;
}) {
  const [items, setItems] = useState<GatheringTransactionView[]>([]);
  const [receipts, setReceipts] = useState<GatheringReceiptView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [years, setYears] = useState<FinanceYear[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [progress, setProgress] = useState('');
  const uploadPending = useRef(false);
  const [viewer, setViewer] = useState<{ uri: string; receipt: GatheringReceiptView } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [ledger, files, summary] = await Promise.all([
        api.eventTransactions(groupId, eventId),
        api.eventReceipts(groupId, eventId),
        api.finance(groupId),
      ]);
      setItems(ledger.items);
      setReceipts(files.items);
      setYears(summary.years);
      // A failed/expired thumbnail must not hide the ledger or remaining receipts.
      const urls = await Promise.all(
        files.items
          .filter((item) => item.mimeType.startsWith('image/'))
          .map(async (item) => {
            try {
              return [item.id, (await api.downloadReceipt(groupId, item.id)).url] as const;
            } catch {
              return null;
            }
          }),
      );
      setThumbs(Object.fromEntries(urls.filter((entry) => entry !== null)));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '재무를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);
  useEffect(() => {
    if (active) void load();
  }, [load, active]);
  const eventYear = financeYearState(startsAt, years);
  const writable = canWrite && eventYear === 'OPEN';
  const attachable = canAttach && eventYear === 'OPEN';
  const paidYear = financeYearState(paidAtFromCalendarDate(paidOn), years);
  const totals = summarizeLedger(0, items);

  const save = async () => {
    if (saving) return;
    setFormError('');
    if (!label.trim() || label.trim().length > 80) {
      setFormError('항목명은 1~80자로 입력해 주세요.');
      return;
    }
    if (!/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
      setFormError('금액은 1원 이상의 정수로 입력해 주세요.');
      return;
    }
    if (paidYear !== 'OPEN') {
      setFormError(
        paidYear === 'CLOSED'
          ? '마감된 회계연도의 거래는 추가할 수 없습니다.'
          : '거래 날짜에 해당하는 회계연도가 열려 있지 않습니다.',
      );
      return;
    }
    setSaving(true);
    try {
      await api.createTransaction(groupId, eventId, {
        direction,
        label: label.trim(),
        amountWon: Number(amount),
        paidAt: paidAtFromCalendarDate(paidOn),
        note: note.trim() || null,
      });
      setEditing(false);
      setMessage('거래를 저장했습니다.');
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '거래를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const attach = async (photos: boolean) => {
    if (uploadPending.current) return;
    uploadPending.current = true;
    setAttaching(true);
    setMessage('');
    let completed = 0;
    const failures: string[] = [];
    try {
      let files: Array<{ uri: string; mimeType: string; sizeBytes: number; originalName?: string }>;
      if (photos) {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error('사진 접근을 허용해 주세요.');
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 1,
        });
        if (picked.canceled) return;
        files = [];
        for (const asset of picked.assets) {
          try {
            files.push(await prepareAsset(asset));
          } catch {
            failures.push(asset.fileName ?? '사진');
          }
        }
      } else {
        const picked = await File.pickFileAsync().catch(() => null);
        if (!picked) return;
        files = (Array.isArray(picked) ? picked : [picked]).map((pickedFile) => {
          const file = new File(pickedFile.uri);
          return {
            uri: file.uri,
            mimeType: receiptMime(file),
            sizeBytes: file.size,
            originalName: file.name || fileName(file.uri),
          };
        });
      }
      for (const [index, file] of files.entries()) {
        try {
          if (!file.sizeBytes) throw new Error('파일 크기를 확인하지 못했습니다.');
          const created = await api.createReceiptUploads(groupId, eventId, [
            { mimeType: file.mimeType, sizeBytes: file.sizeBytes, originalName: file.originalName },
          ]);
          const target = created.items[0];
          if (!target) throw new Error('업로드 주소를 받지 못했습니다.');
          await putPreparedFile(file.uri, target.uploadUrl, target.headers, (loaded, total) =>
            setProgress(
              `${index + 1}/${files.length} · ${total > 0 ? Math.round((loaded / total) * 100) : 0}%`,
            ),
          );
          await api.completeReceipt(groupId, eventId, target.id, file.sizeBytes);
          completed += 1;
        } catch (error) {
          failures.push(
            `${file.originalName ?? '영수증'}: ${error instanceof Error ? error.message : '첨부 실패'}`,
          );
        }
      }
      setMessage(
        `영수증 ${completed}장 첨부${failures.length ? ` · 실패 ${failures.length}장. 실패한 파일을 다시 선택해 주세요.\n${failures.join('\n')}` : '했습니다.'}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '영수증을 첨부하지 못했습니다.');
    } finally {
      if (completed) await load();
      setProgress('');
      setAttaching(false);
      uploadPending.current = false;
    }
  };
  const showReceipt = async (receipt: GatheringReceiptView) => {
    try {
      await openReceipt(groupId, receipt, undefined, (uri) => setViewer({ uri, receipt }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '영수증을 열지 못했습니다.');
    }
  };
  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <View style={styles.eventSummary}>
        <EventMoney label="수입 합계" value={totals.incomeWon} />
        <EventMoney label="지출 합계" value={totals.expenseWon} />
        <EventMoney label="차액" value={totals.incomeWon - totals.expenseWon} />
      </View>
      {message ? <Notice>{message}</Notice> : null}
      {items.length === 0 ? <Body>등록된 거래가 없습니다</Body> : null}
      {items.map((item) => (
        <View key={item.id} style={styles.transaction}>
          <Text style={styles.cardLabel}>
            {new Date(item.paidAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} ·{' '}
            {item.direction === 'INCOME' ? '수입' : '지출'}
          </Text>
          <Text style={styles.line}>
            {item.label} · {WON.format(item.amountWon)}원
          </Text>
          {item.note ? <Body>{item.note}</Body> : null}
        </View>
      ))}
      {writable ? (
        <Button
          label="수입·지출 추가"
          variant="secondary"
          onPress={() => {
            setLabel('');
            setAmount('');
            setNote('');
            setDirection('EXPENSE');
            setPaidOn(new Date(startsAt));
            setFormError('');
            setEditing(true);
          }}
        />
      ) : null}
      {writable && editing ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => {
            if (!saving) setEditing(false);
          }}
        >
          <Screen modal>
            <Text style={styles.line}>수입·지출 추가</Text>
            <View style={styles.row}>
              <Button
                label="지출"
                variant={direction === 'EXPENSE' ? 'primary' : 'secondary'}
                onPress={() => setDirection('EXPENSE')}
              />
              <Button
                label="수입"
                variant={direction === 'INCOME' ? 'primary' : 'secondary'}
                onPress={() => setDirection('INCOME')}
              />
            </View>
            <DateTimeField label="거래 날짜" mode="date" value={paidOn} onChange={setPaidOn} />
            <TextField label="항목명" value={label} onChangeText={setLabel} maxLength={80} />
            <TextField
              label="금액(원)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
            />
            <TextField label="비고" value={note} onChangeText={setNote} multiline maxLength={500} />
            {formError ? <Notice>{formError}</Notice> : null}
            <Button label="저장" loading={saving} onPress={() => void save()} />
            <Button
              label="닫기"
              disabled={saving}
              variant="text"
              onPress={() => setEditing(false)}
            />
          </Screen>
        </Modal>
      ) : null}
      <Text style={styles.line}>영수증</Text>
      {receipts.length === 0 ? <Body>등록된 영수증이 없습니다</Body> : null}
      <View style={styles.row}>
        {receipts.map((receipt) => (
          <Pressable
            key={receipt.id}
            accessibilityRole="button"
            accessibilityLabel={receipt.originalName ?? '영수증 전체 보기'}
            onPress={() => void showReceipt(receipt)}
          >
            {thumbs[receipt.id] ? (
              <Image source={{ uri: thumbs[receipt.id] }} style={styles.thumb} />
            ) : (
              <Text style={styles.line}>{receipt.originalName ?? '영수증'}</Text>
            )}
          </Pressable>
        ))}
      </View>
      {attachable ? (
        <>
          <Button
            label="영수증 여러 장 첨부"
            loading={attaching}
            variant="secondary"
            onPress={() => void attach(true)}
          />
          <Button
            label="파일 첨부(PDF 등)"
            disabled={attaching}
            variant="text"
            onPress={() => void attach(false)}
          />
        </>
      ) : null}
      {progress ? <Body>{progress}</Body> : null}
      {eventYear === 'CLOSED' ? <Notice>마감된 회계연도는 조회만 가능합니다.</Notice> : null}
      {eventYear === 'MISSING' && (canWrite || canAttach) ? (
        <Notice>행사 날짜에 해당하는 회계연도가 열려 있지 않습니다.</Notice>
      ) : null}
      {viewer ? (
        <MediaViewer
          kind="PHOTO"
          uri={viewer.uri}
          fileName={viewer.receipt.originalName ?? undefined}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </View>
  );
}
function EventMoney({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.eventMoney}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.eventMoneyValue}>{WON.format(value)}원</Text>
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
  if (
    mimeType === 'application/pdf' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/webp'
  ) {
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
  eventMoneyValue: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  eventSummary: { flexDirection: 'row', gap: 4 },
  eventMoney: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    backgroundColor: theme.colors.bg.default,
    padding: 8,
    borderRadius: 8,
  },
  transaction: {
    gap: 4,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.default,
  },
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
