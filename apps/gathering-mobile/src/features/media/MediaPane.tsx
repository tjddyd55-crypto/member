import { uploadVideoPoster, videoThumbnail } from './video-posters';
import { ProgressBar } from '../../design/ProgressBar';
import { useAppAlert } from '../../design/dialog';
import { SelectCheckbox } from '../../design/SelectCheckbox';
import { useInvalidatedRefresh, useRefreshLoad } from '../../state/useInvalidatedRefresh';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { canOpenMediaPicker } from './picker-access';
import type { GatheringMediaView } from '@member/contracts';
import {
  canRetryTransfer,
  signedUrlStillFresh,
  summarizeTransfer,
  type TransferState,
} from '@member/gathering-domain';
import { api, ApiError } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice, Screen } from '../../design/ui';
import { theme } from '../../theme';
import { MediaViewer } from './MediaViewer';
import { prepareAsset, putPreparedFile, type PreparedUpload } from './prepare';
import { uploadBlockReason } from './upload-block';
import { useToast } from '../../design/toast';
import { mediaDeletePrompt } from './delete-values';
import { mediaGridLayout } from './grid-layout';
import { requestDownloadPermission, saveDownload } from './save-download';
import { downloadFileName } from './viewer-values';

type Job = {
  id: string;
  name: string;
  state: TransferState;
  loaded: number;
  total: number;
  message: string;
  file: PreparedUpload;
  assetId?: string;
  uploadUrl?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
};

type DownloadJob = {
  item: GatheringMediaView;
  name: string;
  state: 'queued' | 'done' | 'failed';
};

export function MediaPane({
  groupId,
  eventId,
  folderId,
  onTitle,
  uploadLinks,
  active = true,
  contentInset = 0,
}: {
  groupId: string;
  eventId?: string;
  folderId?: string;
  onTitle?: (title: string) => void;
  uploadLinks?: ReactNode;
  active?: boolean;
  contentInset?: number;
}) {
  const target = eventId
    ? { kind: 'event' as const, id: eventId }
    : { kind: 'folder' as const, id: folderId ?? '' };
  const { alert, dialog } = useAppAlert();
  const toast = useToast();
  const [linksOpen, setLinksOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const downloadPending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const selecting = selected.length > 0;
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);
  const [albumRevision, setAlbumRevision] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);
  const { cellSize } = mediaGridLayout(gridWidth);
  const [items, setItems] = useState<GatheringMediaView[]>([]);
  const [writesAllowed, setWritesAllowed] = useState<boolean | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState<{
    items: GatheringMediaView[];
    initialIndex: number;
  } | null>(null);
  const inFlight = useRef(new Set<string>());
  const [picking, setPicking] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const read = useCallback(async () => {
    setMessage('');
    setStatus('loading');
    try {
      if (target.kind === 'folder') {
        const media = await api.folderMedia(groupId, target.id);
        onTitle?.(media.folder.title);
        setItems(media.items);
        setNextCursor(media.nextCursor);
      } else {
        const media = await api.eventMedia(groupId, target.id);
        setItems(media.items);
        setNextCursor(media.nextCursor);
      }
      setAlbumRevision((current) => current + 1);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진·영상을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId, onTitle, target.id, target.kind]);
  const load = useRefreshLoad(read);

  const loadMore = async () => {
    if (!nextCursor) return;
    const media =
      target.kind === 'event'
        ? await api.eventMedia(groupId, target.id, nextCursor)
        : await api.folderMedia(groupId, target.id, nextCursor);
    setItems((current) => [...current, ...media.items]);
    setNextCursor(media.nextCursor);
  };

  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => subscription.remove();
  }, [load, active]);

  useInvalidatedRefresh(groupId, 'media', load, active);

  const reserveBatch = async (pending: Job[]) => {
    for (let index = 0; index < pending.length; index += 20) {
      const chunk = pending.slice(index, index + 20);
      const items = chunk.map((job) => toIntent(job.file));
      const created =
        target.kind === 'event'
          ? await api.createMediaUploads(groupId, target.id, items)
          : await api.createFolderUploads(groupId, target.id, items);
      chunk.forEach((job, offset) => {
        const target = created.items[offset];
        if (!target) return;
        assignUpload(job, target);
      });
    }
  };

  const transfer = async (job: Job) => {
    if (inFlight.current.has(job.id)) return;
    inFlight.current.add(job.id);
    updateJob(job.id, { state: 'uploading', message: '' });
    try {
      if (!job.assetId) await reserveBatch([job]);
      if (!job.assetId) throw new Error('업로드 주소를 받지 못했습니다.');
      let uploadUrl = job.uploadUrl;
      let headers = job.headers;
      if (!uploadUrl || !headers || !signedUrlStillFresh(job.expiresAt)) {
        const fresh = await refreshUpload(job);
        if (fresh === 'ready') {
          if (job.file.kind === 'VIDEO')
            await uploadVideoPoster(groupId, job.assetId, job.file.uri);
          updateJob(job.id, {
            state: 'done',
            loaded: job.file.sizeBytes,
            total: job.file.sizeBytes,
          });
          return;
        }
        uploadUrl = fresh.uploadUrl;
        headers = fresh.headers;
      }
      await putPreparedFile(job.file.uri, uploadUrl, headers, (loaded, total) => {
        updateJob(job.id, { loaded, total, state: 'uploading' });
      });
      updateJob(job.id, { state: 'confirming' });
      if (target.kind === 'event')
        await api.completeMedia(groupId, target.id, job.assetId, job.file.sizeBytes);
      else await api.completeFolderMedia(groupId, target.id, job.assetId, job.file.sizeBytes);
      if (job.file.kind === 'VIDEO') await uploadVideoPoster(groupId, job.assetId, job.file.uri);
      job.uploadUrl = undefined;
      updateJob(job.id, {
        state: 'done',
        loaded: job.file.sizeBytes,
        total: job.file.sizeBytes,
        uploadUrl: undefined,
      });
    } catch (error) {
      job.uploadUrl = undefined;
      updateJob(job.id, {
        state: 'failed',
        uploadUrl: undefined,
        message:
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : '업로드에 실패했습니다.',
      });
    } finally {
      inFlight.current.delete(job.id);
    }
  };

  useEffect(() => {
    let active = true;
    void api
      .subscription(groupId)
      .then((row) => {
        if (active) setWritesAllowed(row.uploadsAllowed);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [groupId]);

  const uploadReason = uploadBlockReason({
    destinationCount: 1,
    destinationChosen: true,
    writesAllowed,
  });

  const pickAssets = async (kind: 'PHOTO' | 'VIDEO') => {
    if (uploadReason) return;
    const canOpen = await canOpenMediaPicker(
      Platform.OS,
      ImagePicker.requestMediaLibraryPermissionsAsync,
    );
    if (!canOpen) {
      setMessage('앨범 접근을 허용해야 사진·영상을 올릴 수 있습니다.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'PHOTO' ? ['images'] : ['videos'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (picked.canceled) return;
    const next: Job[] = [];
    for (const asset of picked.assets) {
      try {
        const file = await prepareAsset(asset);
        next.push({
          id: `${Date.now()}-${next.length}`,
          name:
            file.originalName ?? `${file.kind === 'VIDEO' ? '영상' : '사진'} ${next.length + 1}`,
          state: 'queued',
          loaded: 0,
          total: file.sizeBytes,
          message: '',
          file,
        });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '파일을 준비하지 못했습니다.');
      }
    }
    setJobs((current) => [...next, ...current]);
    for (let index = 0; index < next.length; index += 20) {
      const chunk = next.slice(index, index + 20);
      try {
        await reserveBatch(chunk.filter((job) => !job.assetId));
      } catch (error) {
        const text =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : '예약을 만들지 못했습니다.';
        setMessage(text);
        for (const job of chunk) {
          if (!job.assetId) updateJob(job.id, { state: 'failed', message: text });
        }
      }
      for (const job of chunk) {
        if (job.assetId) await transfer(job);
      }
    }
    await load();
  };

  const pick = async (kind: 'PHOTO' | 'VIDEO') => {
    if (picking) return;
    setPicking(true);
    try {
      await pickAssets(kind);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드하지 못했습니다.');
    } finally {
      setPicking(false);
    }
  };
  const progress = summarizeTransfer(jobs);
  useEffect(() => {
    if (!progress.done) return;
    const timer = setTimeout(() => {
      setJobs((current) => (current.every((job) => job.state === 'done') ? [] : current));
    }, 3000);
    return () => clearTimeout(timer);
  }, [progress.done]);
  const remove = async (assets: GatheringMediaView[], index?: number) => {
    if (deletePending.current || downloadPending.current || !assets.length) return;
    deletePending.current = true;
    setDeleting(true);
    try {
      if (index !== undefined) await api.deleteMedia(groupId, assets[0].id);
      else if (eventId)
        await api.deleteEventMedia(
          groupId,
          eventId,
          assets.map((item) => item.id),
        );
      else for (const asset of assets) await api.deleteMedia(groupId, asset.id);
      const ids = new Set(assets.map((item) => item.id));
      setViewer((current) => {
        if (!current) return null;
        const remaining = current.items.filter((item) => !ids.has(item.id));
        return remaining.length
          ? {
              items: remaining,
              initialIndex: Math.min(index ?? current.initialIndex, remaining.length - 1),
            }
          : null;
      });
      setItems((current) => current.filter((item) => !ids.has(item.id)));
      setSelected([]);
      setMessage('');
      toast('삭제되었습니다.');
      await load();
    } catch (error) {
      alert('삭제 실패', error instanceof Error ? error.message : '삭제하지 못했습니다.');
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  };
  const confirmRemove = (assets: GatheringMediaView[], index?: number) =>
    alert(mediaDeletePrompt(assets), undefined, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => void remove(assets, index) },
    ]);

  const selectedItems = items.filter((item) => selected.includes(item.id));
  const deletable = selectedItems.filter((item) => item.canDelete);
  const saved = downloads.filter((job) => job.state === 'done').length;
  const failures = downloads.filter((job) => job.state === 'failed');
  const downloadDone = downloads.length > 0 && saved === downloads.length;
  const downloadPercent = Math.round((saved / (downloads.length || 1)) * 100);

  useEffect(() => {
    if (!downloadDone) return;
    const timer = setTimeout(() => {
      setDownloads((current) => (current.every((job) => job.state === 'done') ? [] : current));
    }, 3000);
    return () => clearTimeout(timer);
  }, [downloadDone]);

  async function download(pending: DownloadJob[], newBatch = false) {
    if (downloadPending.current || deletePending.current || !pending.length) return;
    downloadPending.current = true;
    setSaving(true);
    setMessage('');
    try {
      if (!(await requestDownloadPermission())) {
        setMessage('사진과 영상을 저장하려면 설정에서 사진 보관함 저장을 허용해 주세요.');
        return;
      }
      const ids = new Set(pending.map((job) => job.item.id));
      setDownloads((current) =>
        newBatch
          ? pending
          : current.map((job) => (ids.has(job.item.id) ? { ...job, state: 'queued' } : job)),
      );
      if (newBatch) setSelected([]);
      for (const job of pending) {
        let state: DownloadJob['state'] = 'done';
        try {
          const { url } = await api.downloadMedia(groupId, job.item.id);
          await saveDownload(url, job.name);
        } catch {
          state = 'failed';
        }
        setDownloads((current) =>
          current.map((entry) => (entry.item.id === job.item.id ? { ...entry, state } : entry)),
        );
      }
    } catch {
      setMessage('사진 보관함 저장 권한을 확인하지 못했습니다.');
    } finally {
      downloadPending.current = false;
      setSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      {!viewer ? dialog : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {message ? <Notice>{message}</Notice> : null}
      <View style={styles.uploadRow}>
        {(['사진 올리기', '영상 올리기', '업로드 링크'] as const).map((label, index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            disabled={index === 2 ? !uploadLinks : Boolean(uploadReason) || picking}
            style={[
              styles.uploadButton,
              (index === 2 ? !uploadLinks : Boolean(uploadReason) || picking) && { opacity: 0.4 },
            ]}
            onPress={() =>
              index === 2 ? setLinksOpen(true) : void pick(index === 0 ? 'PHOTO' : 'VIDEO')
            }
          >
            <Text numberOfLines={1} style={styles.uploadLabel}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {linksOpen ? (
        <Modal visible animationType="slide" onRequestClose={() => setLinksOpen(false)}>
          <Screen modal>
            {uploadLinks}
            <Button label="닫기" variant="text" onPress={() => setLinksOpen(false)} />
          </Screen>
        </Modal>
      ) : null}
      {uploadReason ? <Notice>{uploadReason}</Notice> : null}
      {jobs.length > 0 ? (
        <View style={styles.uploadProgress}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>
              {progress.done ? '업로드 완료' : '업로드 중'} {progress.completed}/{progress.count}
              {jobs.every((job) => job.file.kind === 'PHOTO') ? '장' : '개'}
              {progress.failed > 0 ? ` · 실패 ${progress.failed}` : ''}
            </Text>
            <Text style={styles.uploadLabel}>{progress.percent}%</Text>
          </View>
          <ProgressBar percent={progress.percent} />
          {jobs
            .filter((job) => canRetryTransfer(job.state))
            .map((job) => (
              <View key={job.id} style={styles.failedJob}>
                <View style={styles.failureText}>
                  <Text numberOfLines={1} style={styles.jobTitle}>
                    {job.name}
                  </Text>
                  <Text style={styles.errorText}>{job.message}</Text>
                </View>
                <Button
                  label="다시 시도"
                  disabled={picking}
                  variant="text"
                  onPress={() => void transfer(job).then(() => load())}
                />
              </View>
            ))}
          {progress.failed > 1 ? (
            <Button
              label="실패한 항목 모두 다시 시도"
              disabled={picking}
              variant="text"
              onPress={() =>
                void (async () => {
                  for (const job of jobs.filter((job) => canRetryTransfer(job.state))) {
                    await transfer(job);
                  }
                  await load();
                })()
              }
            />
          ) : null}
        </View>
      ) : null}
      {status === 'ready' && items.length === 0 ? (
        eventId ? (
          <Body>등록된 사진이 없습니다</Body>
        ) : (
          <EmptyState title="아직 올린 사진·영상이 없습니다" />
        )
      ) : null}
      {downloads.length > 0 ? (
        <View style={styles.uploadProgress}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel} accessibilityLiveRegion="polite">
              {downloadDone ? '저장 완료' : saving ? '저장 중' : '저장 결과'} {saved}/
              {downloads.length}
              {downloads.every((job) => job.item.kind === 'PHOTO') ? '장' : '개'}
              {failures.length ? ` · 실패 ${failures.length}` : ''}
            </Text>
            <Text style={styles.uploadLabel}>{downloadPercent}%</Text>
          </View>
          <ProgressBar percent={downloadPercent} />
          {failures.map((job) => (
            <View key={job.item.id} style={styles.failedJob}>
              <Text numberOfLines={1} style={[styles.jobTitle, styles.failureText]}>
                {job.name}
              </Text>
              <Button
                label="다시 시도"
                variant="text"
                disabled={saving || deleting}
                onPress={() => void download([job])}
              />
            </View>
          ))}
          {failures.length > 1 ? (
            <Button
              label="실패한 항목 모두 다시 시도"
              variant="text"
              disabled={saving || deleting}
              onPress={() => void download(failures)}
            />
          ) : null}
        </View>
      ) : null}
      {selecting ? (
        <View style={styles.selectionBar}>
          <Body>{selected.length}개 선택 ·</Body>
          <Button
            label="다운로드"
            variant="text"
            disabled={saving || deleting || selectedItems.length === 0}
            onPress={() =>
              void download(
                selectedItems.map((item) => ({
                  item,
                  name: downloadFileName(
                    item.originalName ?? `JCI-${item.id}`,
                    item.mimeType,
                    item.kind,
                  ),
                  state: 'queued',
                })),
                true,
              )
            }
          />
          <Button
            label="삭제"
            variant="text"
            disabled={saving || deleting || deletable.length === 0}
            onPress={() => confirmRemove(deletable)}
          />
          <Button
            label="취소"
            variant="text"
            disabled={saving || deleting}
            onPress={() => setSelected([])}
          />
        </View>
      ) : null}
      <View
        style={[
          styles.grid,
          { marginHorizontal: 6 - theme.layout.horizontalGutter - contentInset },
        ]}
        onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
      >
        {items.map((item, index) => (
          <MediaThumb
            key={`${item.id}:${albumRevision}`}
            label={`${item.kind === 'VIDEO' ? '영상' : '사진'} ${index + 1}`}
            groupId={groupId}
            cellSize={cellSize}
            item={item}
            selecting={selecting}
            selected={selected.includes(item.id)}
            disabled={
              deleting ||
              saving ||
              (selecting && !selected.includes(item.id) && selected.length >= 100)
            }
            onLongPress={() => {
              if (!selecting && !deleting && !saving) setSelected([item.id]);
            }}
            onOpen={() =>
              selecting
                ? setSelected((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : current.length < 100
                        ? [...current, item.id]
                        : current,
                  )
                : void open(item)
            }
          />
        ))}
      </View>
      {nextCursor ? (
        <Button
          label="이전 사진 더 보기"
          variant="secondary"
          onPress={() =>
            void loadMore().catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : '사진을 더 불러오지 못했습니다.'),
            )
          }
        />
      ) : null}
      {viewer ? (
        <MediaViewer
          overlay={dialog}
          key={viewer.items.map((item) => item.id).join(',')}
          items={viewer.items}
          deleting={deleting}
          onDelete={(item, index) =>
            confirmRemove(
              viewer.items.filter((entry) => entry.id === item.id),
              index,
            )
          }
          initialIndex={viewer.initialIndex}
          resolveUri={async (item) => (await api.downloadMedia(groupId, item.id)).url}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </View>
  );

  async function open(item: GatheringMediaView) {
    setViewer({
      items: [...items],
      initialIndex: items.findIndex((entry) => entry.id === item.id),
    });
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  function assignUpload(
    job: Job,
    target: { id: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string },
  ) {
    job.assetId = target.id;
    job.uploadUrl = target.uploadUrl;
    job.headers = target.headers;
    job.expiresAt = target.expiresAt;
    updateJob(job.id, {
      assetId: target.id,
      uploadUrl: target.uploadUrl,
      headers: target.headers,
      expiresAt: target.expiresAt,
    });
  }

  async function refreshUpload(
    job: Job,
  ): Promise<'ready' | { uploadUrl: string; headers: Record<string, string> }> {
    if (!job.assetId) throw new Error('업로드 주소를 받지 못했습니다.');
    try {
      const resumed =
        target.kind === 'event'
          ? await api.resumeMedia(groupId, target.id, job.assetId)
          : await api.resumeFolderMedia(groupId, target.id, job.assetId);
      if (resumed.status === 'READY') return 'ready';
      assignUpload(job, resumed);
      return { uploadUrl: resumed.uploadUrl, headers: resumed.headers };
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'UPLOAD_FAILED' || error.code === 'UPLOAD_EXPIRED')
      ) {
        job.assetId = undefined;
        job.uploadUrl = undefined;
        job.headers = undefined;
        job.expiresAt = undefined;
        updateJob(job.id, {
          assetId: undefined,
          uploadUrl: undefined,
          headers: undefined,
          expiresAt: undefined,
        });
        await reserveBatch([job]);
        if (!job.uploadUrl || !job.headers) throw new Error('업로드 주소를 받지 못했습니다.');
        return { uploadUrl: job.uploadUrl, headers: job.headers };
      }
      throw error;
    }
  }
}

function toIntent(file: PreparedUpload) {
  return {
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    durationMs: file.durationMs,
    width: file.width,
    height: file.height,
    originalName: file.originalName,
  };
}

function MediaThumb({
  groupId,
  item,
  label,
  onOpen,
  onLongPress,
  cellSize,
  selecting,
  selected,
  disabled,
}: {
  groupId: string;
  item: GatheringMediaView;
  label: string;
  onOpen: () => void;
  onLongPress: () => void;
  cellSize?: number;
  selecting?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .downloadMedia(groupId, item.id)
      .then(async (result) => {
        if (item.kind === 'PHOTO') {
          if (active) setUri(result.url);
        } else if (result.posterUrl) {
          if (active) setUri(result.posterUrl);
        } else if (Platform.OS !== 'web') {
          const poster = await videoThumbnail(item.id, result.url);
          if (active) setUri(poster);
          if (item.canDelete || item.mine) void uploadVideoPoster(groupId, item.id, result.url);
        }
      })
      .catch(() => {
        if (active) setUri(null);
      });
    return () => {
      active = false;
    };
  }, [groupId, item.id, item.kind, item.hasPoster, item.canDelete, item.mine]);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      onPress={onOpen}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityState={{ disabled, selected }}
      style={[
        styles.cell,
        cellSize !== undefined && { width: cellSize, height: cellSize },
        item.kind === 'VIDEO' && styles.videoCell,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : item.kind === 'PHOTO' ? (
        <Text style={styles.cellLabel}>사진</Text>
      ) : null}
      {item.kind === 'VIDEO' ? (
        <View style={styles.playBadge}>
          <Text style={styles.playLabel}>▶</Text>
        </View>
      ) : null}
      {selecting ? <SelectCheckbox selected={Boolean(selected)} size={20} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  uploadRow: { flexDirection: 'row', gap: 6 },
  uploadButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: theme.colors.primary.soft,
  },
  uploadLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.primary.default },
  selectionBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  stack: { gap: theme.space[12] },
  uploadProgress: { gap: 8 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressLabel: { flex: 1, ...theme.typography.bodySmall, color: theme.colors.text.primary },
  failedJob: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failureText: { flex: 1, minWidth: 0 },
  errorText: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  jobTitle: { ...theme.typography.body, color: theme.colors.text.primary },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginHorizontal: 6 - theme.layout.horizontalGutter,
  },
  videoCell: { backgroundColor: theme.colors.text.primary },
  playBadge: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playLabel: { color: '#FFFFFF', fontSize: 18 },
  cell: {
    width: 104,
    height: 104,
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabel: { ...theme.typography.bodySmall, color: theme.colors.text.primary },
  thumb: { width: '100%', height: '100%', borderRadius: theme.radius[12] },
});
