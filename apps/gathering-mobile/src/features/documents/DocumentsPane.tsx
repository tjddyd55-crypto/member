import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useToast } from '../../design/toast';
import { useInvalidatedRefresh } from '../../state/useInvalidatedRefresh';
import { ApiError } from '../../api/client';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import { Body, Button, Screen, TextField, Title } from '../../design/ui';
import { theme } from '../../theme';
import { documentApi, type DocumentFile, type DocumentFolder, type DocumentLocation } from './api';
import { DocumentDestination } from './DocumentDestination';
import { PdfPreview } from './PdfPreview';
import { transferDocumentFile, uploadDocument } from './transfer';

const root: DocumentLocation = { eventId: null, folderId: null };
const allowed = new Set('hwp hwpx doc docx ppt pptx xls xlsx pdf jpg jpeg png gif webp heic txt csv zip'.split(' '));
const images = new Set('jpg jpeg png gif webp heic'.split(' '));
const messageFor = (error: unknown) => error instanceof Error ? error.message : '자료실 작업을 완료하지 못했습니다.';
const fileSize = (bytes: number) => bytes >= 1024 ** 2
  ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
  : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;

type Selected = { file: DocumentFile } | { folder: DocumentFolder };
type Editor = { label: string; initial: string; save: (text: string) => Promise<unknown> };
type Job = {
  key: number; asset: DocumentPickerAsset; location: DocumentLocation; progress: number;
  status: 'pending' | 'uploading' | 'done' | 'failed'; error?: string; finalizeId?: string;
};

export function DocumentsPane({ groupId, eventId, active = true }: { groupId: string; eventId?: string; active?: boolean }) {
  const toast = useToast();
  const [sortOpen, setSortOpen] = useState(false);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const api = useMemo(() => documentApi(groupId), [groupId]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [chosenEvent, setChosenEvent] = useState<{ id: string; title: string; archived: boolean } | null>(null);
  const currentEvent = eventId ?? chosenEvent?.id ?? null;
  const location = useMemo(() => ({ folderId, eventId: currentEvent }), [folderId, currentEvent]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 180); return () => clearTimeout(timer); }, [query]);
  const [sort, setSort] = useState<'recent' | 'oldest' | 'name'>('recent');
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [folder, setFolder] = useState<{ name: string; parentId: string | null } | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [maxBytes, setMaxBytes] = useState(0);
  const [offset, setOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<Selected | null>(null);
  const [move, setMove] = useState<Selected | null>(null);
  const [eventPicker, setEventPicker] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<Selected | null>(null);
  const [preview, setPreview] = useState<{ file: DocumentFile; url: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [working, setWorking] = useState(false);
  const actionLock = useRef(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const nextJob = useRef(0);
  const generation = useRef(0);

  const load = useCallback(async (page = 0) => {
    const run = ++generation.current;
    setLoading(true);
    setLoadError(false);
    if (!page) {
      setFiles([]);
      setFolders([]);
      setOffset(null);
    }
    try {
      const data = await api.list(location, search, sort, page);
      if (run !== generation.current) return;
      setFiles((prev) => page ? [...prev, ...data.files.filter((entry) => !prev.some((item) => item.id === entry.id))] : data.files);
      setFolders((prev) => page ? [...prev, ...data.folders.filter((entry) => !prev.some((item) => item.id === entry.id))] : data.folders);
      setFolder(data.folder);
      setTrail(data.breadcrumbs);
      setCanManage(data.canManage);
      setMaxBytes(data.maxBytes);
      setOffset(data.nextOffset);
    } catch (error) {
      if (run !== generation.current) return;
      setLoadError(true);
      setMessage(messageFor(error));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [api, location, search, sort]);

  useFocusEffect(useCallback(() => {
    if (active) void load();
    return () => { generation.current++; };
  }, [active, load]));

  useInvalidatedRefresh(groupId, 'documents', load, active);
  useFocusEffect(useCallback(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (folderId) { setFolderId(folder?.parentId ?? null); resetSearch(); return true; }
      if (chosenEvent) { setChosenEvent(null); resetSearch(); return true; }
      return false;
    });
    return () => listener.remove();
  }, [active, folderId, folder?.parentId, chosenEvent]));
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const runAction = async (action: () => Promise<unknown>, close?: () => void) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setMessage('');
    try {
      setJobs((items) => items.filter((job) => job.status !== 'done'));
      await action();
      close?.();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setWorking(false);
      actionLock.current = false;
    }
  };

  const setJob = (key: number, update: Partial<Job>) =>
    setJobs((current) => current.map((item) => item.key === key ? { ...item, ...update } : item));
  const send = async (job: Job) => {
    let id = job.finalizeId;
    setJob(job.key, { status: 'uploading', error: undefined, progress: id ? 100 : 0 });
    try {
      const { asset } = job;
      if (!id) {
        const extension = asset.name.includes('.') ? asset.name.split('.').at(-1)!.toLowerCase() : '';
        if (!allowed.has(extension)) throw new Error('지원하지 않는 파일 형식입니다.');
        if (!asset.size || asset.size > maxBytes) throw new Error(`파일 크기 한도는 ${fileSize(maxBytes)}입니다.`);
        const reservation = await api.reserve({ ...job.location, name: asset.name, mimeType: asset.mimeType, sizeBytes: asset.size });
        try {
          await uploadDocument(asset, reservation.target, (loaded, total) => {
            if (total > 0) setJob(job.key, { progress: Math.min(100, Math.floor(100 * loaded / total)) });
          });
        } catch (error) {
          await api.deleteFile(reservation.id).catch(() => undefined);
          throw error;
        }
        id = reservation.id;
      }
      await api.complete(id);
      setJobs((items) => items.filter((item) => item.key !== job.key));
      toast('파일을 업로드했습니다.');
    } catch (error) {
      const retryFinalize = id && (error instanceof TypeError || (error instanceof ApiError && error.status >= 500));
      if (id && !retryFinalize) await api.deleteFile(id).catch(() => undefined);
      setJob(job.key, { status: 'failed', error: messageFor(error), finalizeId: retryFinalize ? id : undefined });
    }
  };
  const pick = () => runAction(async () => {
    const result = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const batch: Job[] = result.assets.map((asset) => ({
      key: nextJob.current++, asset, location, progress: 0, status: 'pending',
    }));
    setJobs((prev) => [...prev.filter((job) => job.status === 'failed'), ...batch]);
    for (let i = 0; i < batch.length; i += 2) await Promise.all(batch.slice(i, i + 2).map(send));
    await latestLoad.current();
  });

  const resetSearch = () => { setQuery(''); setSearch(''); };
  const edit = (config: Editor) => { setDraft(config.initial); setEditor(config); setSelection(null); };
  const mutate = async (action: () => Promise<unknown>) => { await action(); await latestLoad.current(); toast('변경했습니다.'); };
  const visitFile = (file: DocumentFile, action: 'open' | 'download' | 'share') => runAction(async () => {
    const target = await api.download(file.id);
    if (action === 'open' && (file.extension === 'pdf' || images.has(file.extension))) {
      setPreviewError(false);
      setPreview({ file, url: target.url });
      return;
    }
    await transferDocumentFile(target.url, file, action);
  }, () => setSelection(null));

  const selectMove = (destination: DocumentLocation) => {
    const target = move;
    if (!target) return;
    setMove(null);
    void runAction(() => mutate(() => 'folder' in target
      ? api.saveFolder(target.folder.id, { parentId: destination.folderId, eventId: destination.eventId })
      : api.updateFile(target.file.id, { location: destination })));
  };

  return (
    <View style={styles.stack}>
      <View style={styles.toolbar}>
        <Text accessibilityRole="header" style={styles.heading}>자료실</Text>
        {!chosenEvent?.archived ? <>
          <Icon name="folder-open-outline" label="새 폴더" onPress={() => edit({ label: '새 폴더', initial: '', save: (name) => api.saveFolder(null, { name, parentId: folderId, eventId: currentEvent }) })} />
          <Icon name="cloud-upload-outline" label="파일 업로드" disabled={!maxBytes || working || loading} onPress={() => void pick()} />
        </> : null}
      </View>
      <View style={styles.toolbar}>
        <TextInput accessibilityLabel="파일·폴더 검색" placeholder="파일·폴더 검색" value={query} onChangeText={setQuery} style={styles.search} />
        <Icon name="swap-vertical-outline" label="정렬" onPress={() => setSortOpen(true)} />
      </View>
      <View style={styles.toolbar}>
        {(folderId || chosenEvent) ? <Icon name="arrow-back" label="상위 폴더" onPress={() => {
          if (folderId) { setFolderId(folder?.parentId ?? null); setTrail((items) => items.slice(0, -1)); }
          else setChosenEvent(null);
          resetSearch();
        }} /> : null}
        <Text style={styles.path}>{['자료실', currentEvent ? chosenEvent?.title ?? '행사 자료' : '일반 자료', ...trail.map((item) => item.name)].join(' / ')}</Text>
      </View>
      {!currentEvent && !folderId ? <>
        <Text style={styles.section}>행사별 자료</Text>
        <EventEntries api={api} onSelect={(event) => { setChosenEvent(event); setTrail([]); resetSearch(); }} />
        <Text style={styles.section}>일반 자료</Text>
      </> : null}
      {sortOpen ? <Modal transparent visible animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}><View style={styles.dialog}>
          <Title>정렬</Title>
          {(['recent', 'oldest', 'name'] as const).map((value, index) => <Button key={value} label={['최신순', '오래된순', '이름순'][index]!} variant="text" onPress={() => { setSort(value); setSortOpen(false); }} />)}
          <Button label="닫기" variant="text" onPress={() => setSortOpen(false)} />
        </View></KeyboardAvoidingView>
      </Modal> : null}
      {jobs.map((job) => (
        <View key={job.key} style={styles.job}>
          <Body>{job.asset.name} · {job.status === 'done' ? '완료' : job.status === 'failed' ? job.error : `${job.progress}%`}</Body>
          {job.status === 'failed' ? (
            <View style={styles.actions}>
              <Button label="다시 시도" variant="text" disabled={working}
                onPress={() => void runAction(async () => { await send(job); await latestLoad.current(); })} />
              <Button label="닫기" variant="text" disabled={working}
                onPress={() => void runAction(async () => {
                  if (job.finalizeId) await api.deleteFile(job.finalizeId);
                  setJobs((prev) => prev.filter((item) => item.key !== job.key));
                })} />
            </View>
          ) : null}
        </View>
      ))}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {folders.map((item) => (
        <View key={item.id} style={styles.row}>
          <Pressable accessibilityRole="button" style={styles.entry} onPress={() => { setFolderId(item.id); setTrail((items) => [...items, { id: item.id, name: item.name }]); resetSearch(); }}>
            <Ionicons name="folder-outline" size={25} color={theme.colors.text.primary} />
            <View style={styles.entryText}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>파일 {item.fileCount}개</Text></View>
          </Pressable>
          {(canManage || item.canManage) ? <More name={item.name} onPress={() => setSelection({ folder: item })} /> : null}
        </View>
      ))}
      {files.map((file) => (
        <View key={file.id} style={styles.row}>
          <Pressable accessibilityRole="button" style={styles.entry} onPress={() => void visitFile(file, 'open')}>
            <Ionicons name={images.has(file.extension) ? 'image-outline' : file.extension === 'zip' ? 'archive-outline'
              : ['xls', 'xlsx', 'csv'].includes(file.extension) ? 'grid-outline'
              : ['ppt', 'pptx'].includes(file.extension) ? 'easel-outline'
              : file.extension === 'pdf' ? 'reader-outline' : 'document-text-outline'}
              size={25} color={theme.colors.text.primary} />
            <View style={styles.entryText}>
              <Text numberOfLines={2} style={styles.name}>{file.name}</Text>
              <Text style={styles.meta}>{file.extension.toUpperCase()} · {fileSize(file.sizeBytes)}</Text>
              <Text style={styles.meta}>{new Date(file.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} · {file.uploadedBy}</Text>
            </View>
          </Pressable>
          <More name={file.name} onPress={() => setSelection({ file })} />
        </View>
      ))}
      {loading ? <Body>불러오는 중…</Body> : null}
      {!loading && !loadError && !files.length && !folders.length ? <Body>{search ? '검색 결과가 없습니다' : '등록된 자료가 없습니다'}</Body> : null}
      {!loading && loadError ? <Button label="다시 불러오기" variant="secondary" onPress={() => void load()} /> : null}
      {!loading && offset !== null ? <Button label="더 보기" variant="text" onPress={() => void load(offset)} /> : null}

      {eventPicker || move ? <DocumentDestination api={api} eventId={currentEvent} browseEvents={eventPicker} folderOnly={!!move && 'folder' in move}
        excludeFolder={move && 'folder' in move ? move.folder.id : undefined}
        onCancel={() => { setEventPicker(false); setMove(null); }}
        onSelect={(destination, title, archived) => {
          if (eventPicker && destination.eventId) {
            setFolderId(null);
            resetSearch();
            setChosenEvent({ id: destination.eventId, title: title ?? '행사 자료', archived: !!archived });
            setEventPicker(false);
          } else selectMove(destination);
        }} /> : null}
      {selection ? (
        <Modal visible animationType="slide" onRequestClose={() => setSelection(null)}>
          <Screen modal>
            <Title>{'file' in selection ? selection.file.name : selection.folder.name}</Title>
            {'file' in selection ? (['open', 'download', 'share'] as const).map((action, index) => (
              <Button key={action} label={['열기', '다운로드', '공유'][index]!} variant="secondary" disabled={working}
                onPress={() => void visitFile(selection.file, action)} />
            )) : null}
            {(canManage || ('file' in selection ? selection.file.canDelete : selection.folder.canManage)) ? <>
              <Button label="이름 변경" variant="secondary" onPress={() => edit('folder' in selection
                ? { label: '폴더 이름 변경', initial: selection.folder.name, save: (name) => api.saveFolder(selection.folder.id, { name }) }
                : { label: '파일 이름 변경', initial: selection.file.name, save: (name) => api.updateFile(selection.file.id, { name }) })} />
              <Button label="이동" variant="secondary" onPress={() => { setMove(selection); setSelection(null); }} />
            </> : null}
            {('folder' in selection ? canManage || selection.folder.canManage : selection.file.canDelete) ? <Button label="삭제" variant="text"
              onPress={() => { setConfirm(selection); setSelection(null); }} /> : null}
            {message ? <Body>{message}</Body> : null}
            <Button label="닫기" variant="text" onPress={() => setSelection(null)} />
          </Screen>
        </Modal>
      ) : null}
      {editor || confirm ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => { if (!working) { setEditor(null); setConfirm(null); } }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}><View style={styles.dialog}>
            <Title>{editor?.label ?? '삭제 확인'}</Title>
            {editor ? <TextField label="이름" value={draft} onChangeText={setDraft} maxLength={180} />
              : confirm ? <Body>{'file' in confirm ? confirm.file.name + ' 파일을 삭제할까요?' : confirm.folder.name + ' 폴더를 삭제할까요? 파일이나 하위 폴더가 있으면 삭제되지 않습니다.'}</Body> : null}
            <Button label={editor ? '저장' : '삭제'} disabled={working || (!!editor && !draft.trim())}
              onPress={() => void runAction(() => mutate(() => editor ? editor.save(draft.trim()) :
                confirm && 'file' in confirm ? api.deleteFile(confirm.file.id) : api.deleteFolder(confirm!.folder.id)),
              () => { setEditor(null); setConfirm(null); })} />
            {message ? <Body>{message}</Body> : null}
            <Button label="취소" variant="text" disabled={working} onPress={() => { setEditor(null); setConfirm(null); }} />
          </View></KeyboardAvoidingView>
        </Modal>
      ) : null}
      {preview ? (
        <Modal visible animationType="slide" onRequestClose={() => setPreview(null)}>
          <Screen scroll={false} modal>
            <Title>{preview.file.name}</Title>
            {previewError ? <Body>이 기기에서는 미리 볼 수 없습니다. 다운로드하거나 공유해 주세요.</Body>
              : preview.file.extension === 'pdf' ? <PdfPreview url={preview.url} onError={() => setPreviewError(true)} />
              : <Image source={{ uri: preview.url }} style={{ flex: 1 }} contentFit="contain"
                  cachePolicy="none" onError={() => setPreviewError(true)} />}
            {message ? <Body>{message}</Body> : null}
            <View style={styles.actions}>
              <Button label="다운로드" variant="secondary" disabled={working} onPress={() => void visitFile(preview.file, 'download')} />
              <Button label="공유" variant="secondary" disabled={working} onPress={() => void visitFile(preview.file, 'share')} />
              <Button label="닫기" variant="text" onPress={() => setPreview(null)} />
            </View>
          </Screen>
        </Modal>
      ) : null}
    </View>
  );
}

function More({ name, onPress }: { name: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${name} 메뉴`} onPress={onPress} style={styles.more}>
    <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.text.primary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { flex: 1, fontSize: 20, fontWeight: '700', color: theme.colors.text.primary },
  search: { flex: 1, height: 40, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 8, paddingHorizontal: 12, color: theme.colors.text.primary },
  meta: { fontSize: 12, lineHeight: 18, color: theme.colors.text.secondary },
  path: { flex: 1, fontSize: 12, color: theme.colors.text.secondary },
  section: { fontSize: 13, fontWeight: '700', color: theme.colors.text.secondary, marginTop: 8 },
  overlay: { flex: 1, justifyContent: 'center', padding: theme.layout.horizontalGutter, backgroundColor: 'rgba(0,0,0,0.35)' },
  dialog: { padding: theme.space[12], borderRadius: 12, backgroundColor: theme.colors.bg.default, gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { alignItems: 'center', flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.default },
  entry: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8, minWidth: 0 },
  entryText: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 14, lineHeight: 20, color: theme.colors.text.primary, fontWeight: '700' },
  more: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  message: { ...theme.typography.bodySmall, color: theme.colors.text.primary },
  job: { gap: 4, backgroundColor: theme.colors.bg.subtle, padding: 8, borderRadius: 8 },
});

function Icon({ name, label, onPress, disabled = false }: { name: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 44, height: 44, opacity: disabled ? 0.4 : 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={name} size={22} color={theme.colors.text.primary} /></Pressable>;
}
function EventEntries({ api, onSelect }: { api: ReturnType<typeof documentApi>; onSelect: (event: { id: string; title: string; archived: boolean }) => void }) {
  const [events, setEvents] = useState<import('./api').DocumentEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async (offset = 0) => {
    try { const result = await api.events(offset); setEvents((items) => offset ? [...items, ...result.events] : result.events); setNext(result.nextOffset); setError(''); }
    catch { setError('행사를 불러오지 못했습니다.'); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  return <View>{events.map((event) => <Pressable key={event.id} accessibilityRole="button" onPress={() => onSelect(event)} style={styles.entry}><Ionicons name="calendar-outline" size={22} color={theme.colors.text.primary} /><Text style={styles.name}>{event.title}{event.archived ? ' (보관)' : ''}</Text></Pressable>)}{error ? <Button label={error + ' 다시 시도'} onPress={() => void load()} /> : null}{next !== null ? <Button label="행사 더 보기" variant="text" onPress={() => void load(next)} /> : null}</View>;
}
