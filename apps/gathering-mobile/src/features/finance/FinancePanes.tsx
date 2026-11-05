import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import type { GatheringFinanceSummary, GatheringReceiptView, GatheringTransactionView } from '@member/contracts';
import { summarizeLedger } from '@member/gathering-domain';
import { api } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice, TextField } from '../../design/ui';
import { theme } from '../../theme';
import { putPreparedFile } from '../media/prepare';

const WON = new Intl.NumberFormat('ko-KR');

export function GroupFinancePane({ groupId, canWrite }: { groupId: string; canWrite: boolean }) {
  const [summary, setSummary] = useState<GatheringFinanceSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('0');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setSummary(await api.finance(groupId));
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
  return (
    <View style={styles.stack}>
      <Body>
        {summary.year} 회계연도 {summary.status === 'CLOSED' ? '· 마감됨' : ''}
      </Body>
      <Notice>
        {`기초 ${WON.format(summary.openingBalanceWon)}원 · 수입 ${WON.format(summary.incomeWon)}원 · 지출 ${WON.format(summary.expenseWon)}원 · 잔액 ${WON.format(summary.balanceWon)}원`}
      </Notice>
      {summary.events.length === 0 ? (
        <EmptyState title="기록된 거래가 없습니다" description="행사 재무 탭에서 수입과 지출을 남깁니다." />
      ) : null}
      {summary.events.map((event) => (
        <Text key={event.eventId} style={styles.line}>
          {event.title} · 수입 {WON.format(event.incomeWon)} · 지출 {WON.format(event.expenseWon)}
        </Text>
      ))}
      {summary.dues.map((due) => (
        <Text key={due.id} style={styles.line}>
          {due.displayName} · {due.status} · {WON.format(due.paidAmountWon)}/{WON.format(due.amountWon)}원
        </Text>
      ))}
      {canWrite && summary.status === 'OPEN' ? (
        <>
          <TextField label="회원 아이디" value={memberId} onChangeText={setMemberId} autoCapitalize="none" />
          <TextField label="청구액(원)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <TextField label="납부액(원)" value={paid} onChangeText={setPaid} keyboardType="number-pad" />
          <Button
            label="회비 저장"
            onPress={() =>
              void api
                .saveDue(groupId, {
                  userId: memberId.trim(),
                  year: summary.year,
                  amountWon: Number(amount),
                  paidAmountWon: Number(paid),
                })
                .then(() => load())
                .catch((error: unknown) => setMessage(error instanceof Error ? error.message : '회비를 저장하지 못했습니다.'))
            }
          />
          {message ? <Notice>{message}</Notice> : null}
        </>
      ) : null}
    </View>
  );
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
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [ledger, files] = await Promise.all([
        api.eventTransactions(groupId, eventId),
        api.eventReceipts(groupId, eventId),
      ]);
      setItems(ledger.items);
      setReceipts(files.items);
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
        paidAt: `${paidOn}T12:00:00.000+09:00`,
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
    const picked = await File.pickFileAsync({
      multipleFiles: true,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    });
    if (picked.canceled || !picked.result) return;
    for (const file of picked.result) {
      const mimeType = mimeOf(file.extension);
      const created = await api.createReceiptUploads(groupId, eventId, [
        { mimeType, sizeBytes: file.size, originalName: file.name },
      ]);
      const target = created.items[0];
      if (!target) continue;
      await putPreparedFile(file.uri, target.uploadUrl, target.headers, () => undefined);
      await api.completeReceipt(groupId, eventId, target.id, file.size);
    }
    await load();
  };

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <Notice>{`이 행사 수입 ${WON.format(totals.incomeWon)}원 · 지출 ${WON.format(totals.expenseWon)}원`}</Notice>
      {message ? <Notice>{message}</Notice> : null}
      {items.length === 0 ? <EmptyState title="항목이 없습니다" description="날짜는 실제 결제일입니다. 행사일과 달라도 됩니다." /> : null}
      {items.map((item) => (
        <Text key={item.id} style={styles.line}>
          {item.direction === 'INCOME' ? '수입' : '지출'} {item.label} {WON.format(item.amountWon)}원
          {item.note ? ` · ${item.note}` : ''}
        </Text>
      ))}
      {canWrite ? (
        <>
          <View style={styles.row}>
            <Button label={direction === 'EXPENSE' ? '지출 선택됨' : '지출'} variant={direction === 'EXPENSE' ? 'primary' : 'secondary'} onPress={() => setDirection('EXPENSE')} />
            <Button label={direction === 'INCOME' ? '수입 선택됨' : '수입'} variant={direction === 'INCOME' ? 'primary' : 'secondary'} onPress={() => setDirection('INCOME')} />
          </View>
          <TextField label="항목" value={label} onChangeText={setLabel} />
          <TextField label="금액(원)" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <TextField label="결제일 YYYY-MM-DD" value={paidOn} onChangeText={setPaidOn} autoCapitalize="none" />
          <TextField label="비고" value={note} onChangeText={setNote} />
          <Button label="항목 저장" onPress={() => void save()} />
        </>
      ) : null}
      {receipts.map((receipt) => (
        <Pressable key={receipt.id} accessibilityRole="button" onPress={() => void openReceipt(groupId, receipt.id)}>
          <Text style={styles.line}>{receipt.originalName ?? '영수증'}{receipt.immutable ? ' · 보존' : ''}</Text>
        </Pressable>
      ))}
      {canAttach ? <Button label="영수증 첨부" variant="secondary" onPress={() => void attach().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '영수증을 첨부하지 못했습니다.'))} /> : null}
    </View>
  );
}

async function openReceipt(groupId: string, receiptId: string) {
  const file = await api.downloadReceipt(groupId, receiptId);
  await Linking.openURL(file.url);
}

function mimeOf(extension: string) {
  const normalized = extension.toLowerCase();
  if (normalized === '.pdf') return 'application/pdf';
  if (normalized === '.png') return 'image/png';
  if (normalized === '.webp') return 'image/webp';
  return 'image/jpeg';
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[12] },
  row: { gap: theme.space[8] },
  line: { ...theme.typography.body, color: theme.colors.text.primary },
});
