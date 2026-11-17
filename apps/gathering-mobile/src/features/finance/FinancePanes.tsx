import { ProgressBar } from '../../design/ProgressBar';
import { useAppAlert } from '../../design/dialog';
import { useInvalidatedRefresh, useRefreshLoad } from '../../state/useInvalidatedRefresh';
import { useCallback, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { canOpenMediaPicker } from '../media/picker-access';
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
import { calendarDateFromPaidAt, paidAtFromCalendarDate } from '../forms/values';
import { theme } from '../../theme';
import { MediaViewer } from '../media/MediaViewer';
import { prepareAsset, putPreparedFile } from '../media/prepare';
import { eventFinanceActions, financeYearState, type FinanceYear } from '../events/detail';

import { useToast } from '../../design/toast';
import { formatAmountInput, parseAmountInput, formatWon } from './amount';

import { FiscalYearTabs } from './FiscalYearTabs';

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

  const selectedYear = useRef<number | undefined>(undefined);
  const [visibleYear, setVisibleYear] = useState<number | undefined>();
  const read = useCallback(
    async (year?: number) => {
      if (year !== undefined) {
        selectedYear.current = year;
        setVisibleYear(year);
      }
      setPaidOn(null);
      setMessage('');
      setStatus('loading');
      try {
        const result = await api.finance(groupId, selectedYear.current);
        selectedYear.current = result.year;
        setVisibleYear(result.year);
        setSummary(result);
        setStatus('ready');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '장부를 불러오지 못했습니다.');
        setStatus('error');
      }
    },
    [groupId],
  );
  const load = useRefreshLoad(read);

  useInvalidatedRefresh(groupId, 'finance', load);

  if (!summary) {
    return status === 'error' ? (
      <ErrorState message={message} onRetry={() => void load()} />
    ) : (
      <LoadingState />
    );
  }
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
      <FiscalYearTabs
        years={summary.years}
        selectedYear={visibleYear ?? summary.year}
        onSelect={(year) => void load(year)}
      />
      <View>
        <View
          style={[styles.stack, status !== 'ready' && styles.pending]}
          pointerEvents={status === 'ready' ? 'auto' : 'none'}
        >
          <View style={styles.cards}>
            <MoneyCard label="기초잔액" value={summary.openingBalanceWon} />
            <MoneyCard label="전체 수입" value={summary.incomeWon} />
            <MoneyCard label="전체 지출" value={summary.expenseWon} />
            <MoneyCard label="현재 잔액" value={summary.balanceWon} />
          </View>
          <Body>{`행사 수입 ${WON.format(summary.eventIncomeWon)}원 · 회비 ${WON.format(summary.duesWon)}원`}</Body>
          <View style={styles.segment}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'events' }}
              onPress={() => setTab('events')}
              style={[styles.segmentItem, tab === 'events' && styles.segmentOn]}
            >
              <Text style={[styles.segmentLabel, tab === 'events' && styles.segmentOnText]}>
                행사별 장부
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'dues' }}
              onPress={() => setTab('dues')}
              style={[styles.segmentItem, tab === 'dues' && styles.segmentOn]}
            >
              <Text style={[styles.segmentLabel, tab === 'dues' && styles.segmentOnText]}>
                회원 회비
              </Text>
            </Pressable>
          </View>
          {tab === 'events' ? (
            summary.events.length === 0 ? (
              <EmptyState title="기록된 행사가 없습니다" />
            ) : (
              summary.events.map((event) => (
                <Text key={event.eventId} style={styles.line}>
                  {event.title} · 수입 {WON.format(event.incomeWon)} · 지출{' '}
                  {WON.format(event.expenseWon)} · 순액 {WON.format(event.netWon)}
                </Text>
              ))
            )
          ) : (
            <>
              {summary.dues.length === 0 ? <EmptyState title="회비가 없습니다" /> : null}
              {summary.dues.map((due) => (
                <Text key={due.id} style={styles.line}>
                  {due.displayName} · {dueLabel(due.status)} · {WON.format(due.paidAmountWon)}/
                  {WON.format(due.amountWon)}원
                </Text>
              ))}
              {writable ? (
                <>
                  <TextField label="회원 이름" value={memberName} onChangeText={setMemberName} />
                  <Button label="이름으로 찾기" variant="secondary" onPress={() => void search()} />
                  {matches.map((member) => (
                    <Button
                      key={member.userId}
                      label={
                        picked?.userId === member.userId
                          ? `${member.displayName} 선택됨`
                          : member.displayName
                      }
                      variant={picked?.userId === member.userId ? 'primary' : 'secondary'}
                      onPress={() => {
                        setPicked(member);
                        setPaidOn(null);
                      }}
                    />
                  ))}
                  <TextField
                    label="청구액(원)"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="number-pad"
                  />
                  <TextField
                    label="납부액(원)"
                    value={paid}
                    onChangeText={setPaid}
                    keyboardType="number-pad"
                  />
                  {paidOn ? (
                    <>
                      <DateTimeField
                        label="납부일"
                        mode="date"
                        value={paidOn}
                        onChange={setPaidOn}
                      />
                      <Button
                        label="납부일 지우기"
                        variant="text"
                        onPress={() => setPaidOn(null)}
                      />
                    </>
                  ) : (
                    <Button
                      label="납부일 고르기"
                      variant="secondary"
                      onPress={() => setPaidOn(new Date())}
                    />
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
                        .catch((error: unknown) =>
                          setMessage(
                            error instanceof Error ? error.message : '회비를 저장하지 못했습니다.',
                          ),
                        );
                    }}
                  />
                </>
              ) : null}
            </>
          )}
          {status === 'ready' && message ? <Notice>{message}</Notice> : null}
        </View>
        {status !== 'ready' ? (
          <View style={styles.loadingOverlay}>
            {status === 'loading' ? (
              <LoadingState />
            ) : (
              <ErrorState message={message} onRetry={() => void load()} />
            )}
          </View>
        ) : null}
      </View>
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
  const { alert, dialog } = useAppAlert();
  const toast = useToast();
  const [items, setItems] = useState<GatheringTransactionView[]>([]);
  const [receipts, setReceipts] = useState<GatheringReceiptView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [receiptUploadMessage, setReceiptUploadMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => new Date());
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
  const [years, setYears] = useState<FinanceYear[]>([]);
  const [editing, setEditing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<GatheringTransactionView | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [progress, setProgress] = useState<{
    index: number;
    count: number;
    percent: number;
  } | null>(null);
  const uploadPending = useRef(false);
  const [viewer, setViewer] = useState<{ uri: string; receipt: GatheringReceiptView } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const read = useCallback(async () => {
    setMessage('');
    setFormError('');
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
      setMessage(error instanceof Error ? error.message : '회계를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);
  const load = useRefreshLoad(read);
  useInvalidatedRefresh(groupId, 'finance', load, active);
  const eventYear = financeYearState(startsAt, years);
  const { addTransaction: writable, attachReceipt: attachable } = eventFinanceActions(
    canWrite,
    canAttach,
    startsAt,
    years,
  );
  const paidYear = financeYearState(paidAtFromCalendarDate(paidOn), years);
  const totals = summarizeLedger(0, items);

  const save = async () => {
    if (saving || !canWrite || selectedTransaction?.locked) return;
    setFormError('');
    if (!label.trim() || label.trim().length > 80) {
      setFormError('항목명은 1~80자로 입력해 주세요.');
      return;
    }
    if (
      !amount ||
      !Number.isSafeInteger(parseAmountInput(amount)) ||
      parseAmountInput(amount) <= 0
    ) {
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
      const body = {
        direction,
        label: label.trim(),
        amountWon: parseAmountInput(amount),
        paidAt: paidAtFromCalendarDate(paidOn),
        note: note.trim() || null,
        adjustment: selectedTransaction?.adjustment,
      };
      if (selectedTransaction) await api.updateTransaction(groupId, selectedTransaction.id, body);
      else await api.createTransaction(groupId, eventId, body);
      setReceiptUploadMessage('');
      toast('저장되었습니다.');
      setEditing(false);
      setMessage('');
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
    setReceiptUploadMessage('');
    let completed = 0;
    const failures: string[] = [];
    try {
      let files: Array<{ uri: string; mimeType: string; sizeBytes: number; originalName?: string }>;
      if (photos) {
        const canOpen = await canOpenMediaPicker(
          Platform.OS,
          ImagePicker.requestMediaLibraryPermissionsAsync,
        );
        if (!canOpen) throw new Error('사진 접근을 허용해 주세요.');
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
          setProgress({ index: index + 1, count: files.length, percent: 0 });
          if (!file.sizeBytes) throw new Error('파일 크기를 확인하지 못했습니다.');
          const created = await api.createReceiptUploads(groupId, eventId, [
            { mimeType: file.mimeType, sizeBytes: file.sizeBytes, originalName: file.originalName },
          ]);
          const target = created.items[0];
          if (!target) throw new Error('업로드 주소를 받지 못했습니다.');
          await putPreparedFile(file.uri, target.uploadUrl, target.headers, (loaded, total) =>
            setProgress({
              index: index + 1,
              count: files.length,
              percent:
                total > 0 ? Math.max(0, Math.min(99, Math.round((loaded / total) * 100))) : 0,
            }),
          );
          await api.completeReceipt(groupId, eventId, target.id, file.sizeBytes);
          setProgress({ index: index + 1, count: files.length, percent: 100 });
          completed += 1;
        } catch (error) {
          failures.push(
            `${file.originalName ?? '영수증'}: ${error instanceof Error ? error.message : '첨부 실패'}`,
          );
        }
      }
      setReceiptUploadMessage(
        `영수증 ${completed}장 첨부${failures.length ? ` · 실패 ${failures.length}장. 실패한 파일을 다시 선택해 주세요.\n${failures.join('\n')}` : '했습니다.'}`,
      );
    } catch (error) {
      setReceiptUploadMessage(
        error instanceof Error ? error.message : '영수증을 첨부하지 못했습니다.',
      );
    } finally {
      if (completed) await load();
      setProgress(null);
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
  if (status === 'error')
    return (
      <View style={styles.stack}>
        {!editing && !viewer ? dialog : null}
        <ErrorState message={message} onRetry={() => void load()} />
        {receiptUploadMessage ? <Notice>{receiptUploadMessage}</Notice> : null}
      </View>
    );
  return (
    <View style={styles.stack}>
      {!editing && !viewer ? dialog : null}
      <View style={styles.eventSummary}>
        <EventMoney label="수입 합계" value={totals.incomeWon} />
        <EventMoney label="지출 합계" value={totals.expenseWon} />
        <EventMoney label="차액" value={totals.incomeWon - totals.expenseWon} />
      </View>
      {message ? <Notice>{message}</Notice> : null}
      {receiptUploadMessage ? <Notice>{receiptUploadMessage}</Notice> : null}
      {items.length === 0 ? <Body>등록된 거래가 없습니다</Body> : null}
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={styles.transaction}
          disabled={!canWrite || saving}
          onPress={() => {
            if (item.locked) {
              alert('안내', '마감된 회계연도의 거래는 수정·삭제할 수 없습니다.');
              return;
            }
            setSelectedTransaction(item);
            setLabel(item.label);
            setAmount(formatAmountInput(String(item.amountWon)));
            setNote(item.note ?? '');
            setDirection(item.direction);
            setPaidOn(calendarDateFromPaidAt(item.paidAt));
            setFormError('');
            setEditing(true);
          }}
        >
          {item.locked ? <Body>마감</Body> : null}
          <Text style={styles.cardLabel}>
            {new Date(item.paidAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} ·{' '}
            {item.direction === 'INCOME' ? '수입' : '지출'}
          </Text>
          <Text style={styles.line}>
            {item.label} · {WON.format(item.amountWon)}원
          </Text>
          {item.note ? <Body>{item.note}</Body> : null}
        </Pressable>
      ))}
      {writable ? (
        <Button
          label="수입·지출 추가"
          variant="secondary"
          onPress={() => {
            setSelectedTransaction(null);
            setLabel('');
            setAmount('');
            setNote('');
            setDirection('EXPENSE');
            setPaidOn(new Date());
            setFormError('');
            setEditing(true);
          }}
        />
      ) : null}
      {canWrite && editing ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => {
            if (!saving) setEditing(false);
          }}
        >
          <Screen modal>
            {dialog}
            <Text style={styles.line}>
              {selectedTransaction ? '수입·지출 수정' : '수입·지출 추가'}
            </Text>
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
              value={formatAmountInput(amount)}
              onChangeText={(raw) => setAmount(formatAmountInput(raw))}
              keyboardType="number-pad"
            />
            <TextField label="비고" value={note} onChangeText={setNote} multiline maxLength={500} />
            {formError ? <Notice>{formError}</Notice> : null}
            <Button
              label="저장"
              loading={saving}
              disabled={selectedTransaction?.locked || paidYear !== 'OPEN'}
              onPress={() => void save()}
            />
            {selectedTransaction ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="삭제"
                disabled={saving || selectedTransaction.locked}
                style={{
                  padding: 12,
                  alignItems: 'center',
                  opacity: saving || selectedTransaction.locked ? 0.4 : 1,
                }}
                onPress={() =>
                  alert('이 거래를 삭제할까요?', undefined, [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '삭제',
                      style: 'destructive',
                      onPress: () => {
                        setSaving(true);
                        void api
                          .deleteTransaction(groupId, selectedTransaction.id)
                          .then(async () => {
                            setReceiptUploadMessage('');
                            toast('삭제되었습니다.');
                            setEditing(false);
                            await load();
                          })
                          .catch((error: unknown) =>
                            setFormError(
                              error instanceof Error ? error.message : '삭제하지 못했습니다.',
                            ),
                          )
                          .finally(() => setSaving(false));
                      },
                    },
                  ])
                }
              >
                <Text style={{ color: '#B42318', fontWeight: '600' }}>삭제</Text>
              </Pressable>
            ) : null}
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
      {progress ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Body>
              영수증 {progress.index}/{progress.count}장
            </Body>
            <Body>{progress.percent}%</Body>
          </View>
          <ProgressBar percent={progress.percent} />
        </View>
      ) : null}
      {eventYear === 'CLOSED' ? <Notice>마감</Notice> : null}
      {eventYear === 'MISSING' && canAttach ? <Notice>회계연도 없음</Notice> : null}
      {viewer ? (
        <MediaViewer
          overlay={dialog}
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
      <Text style={styles.eventMoneyValue}>{formatWon(value)}</Text>
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
  pending: { opacity: 0 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject },
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
