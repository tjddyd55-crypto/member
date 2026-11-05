import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { GatheringMediaView } from '@member/contracts';
import { canRetryTransfer, signedUrlStillFresh, summarizeTransfer, type TransferState } from '@member/gathering-domain';
import { api, ApiError } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice } from '../../design/ui';
import { theme } from '../../theme';
import { MediaViewer } from './MediaViewer';
import { prepareAsset, putPreparedFile, type PreparedUpload } from './prepare';
import { uploadBlockReason } from './upload-block';

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

export function MediaPane({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [items, setItems] = useState<GatheringMediaView[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [uploadsAllowed, setUploadsAllowed] = useState(false);
  const [handoverStatus, setHandoverStatus] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; kind: 'PHOTO' | 'VIDEO' } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [media, usage, handover] = await Promise.all([
        api.eventMedia(groupId, eventId),
        api.storage(groupId),
        api.handover(groupId).catch(() => null),
      ]);
      setItems(media.items);
      setNextCursor(media.nextCursor);
      setUploadsAllowed(usage.subscriptionActive);
      setHandoverStatus(handover?.handover?.status ?? null);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진·영상을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const media = await api.eventMedia(groupId, eventId, nextCursor);
    setItems((current) => [...current, ...media.items]);
    setNextCursor(media.nextCursor);
  };

  useEffect(() => {
    void load();
  }, [load]);

  const reserveBatch = async (pending: Job[]) => {
    for (let index = 0; index < pending.length; index += 20) {
      const chunk = pending.slice(index, index + 20);
      const created = await api.createMediaUploads(groupId, eventId, chunk.map((job) => toIntent(job.file)));
      chunk.forEach((job, offset) => {
        const target = created.items[offset];
        if (!target) return;
        assignUpload(job, target);
      });
    }
  };

  const transfer = async (job: Job) => {
    updateJob(job.id, { state: 'uploading', message: '' });
    try {
      if (!job.assetId) await reserveBatch([job]);
      if (!job.assetId) throw new Error('업로드 주소를 받지 못했습니다.');
      let uploadUrl = job.uploadUrl;
      let headers = job.headers;
      if (!uploadUrl || !headers || !signedUrlStillFresh(job.expiresAt)) {
        const fresh = await refreshUpload(job);
        if (fresh === 'ready') {
          updateJob(job.id, { state: 'done', loaded: job.file.sizeBytes, total: job.file.sizeBytes });
          return;
        }
        uploadUrl = fresh.uploadUrl;
        headers = fresh.headers;
      }
      await putPreparedFile(job.file.uri, uploadUrl, headers, (loaded, total) => {
        updateJob(job.id, { loaded, total, state: 'uploading' });
      });
      updateJob(job.id, { state: 'confirming' });
      await api.completeMedia(groupId, eventId, job.assetId, job.file.sizeBytes);
      job.uploadUrl = undefined;
      updateJob(job.id, { state: 'done', loaded: job.file.sizeBytes, total: job.file.sizeBytes, uploadUrl: undefined });
    } catch (error) {
      job.uploadUrl = undefined;
      updateJob(job.id, {
        state: 'failed',
        uploadUrl: undefined,
        message: error instanceof ApiError ? error.message : error instanceof Error ? error.message : '업로드에 실패했습니다.',
      });
    }
  };

  const uploadReason = uploadBlockReason({ handoverStatus, uploadsAllowed, destinationCount: 1, destinationChosen: true });

  const pick = async (kind: 'PHOTO' | 'VIDEO') => {
    if (uploadReason) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
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
          name: file.originalName ?? (file.kind === 'VIDEO' ? '영상' : '사진'),
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
        const text = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '예약을 만들지 못했습니다.';
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

  const progress = summarizeTransfer(jobs);

  return (
    <View style={styles.stack}>
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {message ? <Notice>{message}</Notice> : null}
      <Button label="사진 올리기" disabled={Boolean(uploadReason)} onPress={() => void pick('PHOTO')} />
      <Button label="영상 올리기" disabled={Boolean(uploadReason)} onPress={() => void pick('VIDEO')} />
      {uploadReason ? <Notice>{uploadReason}</Notice> : null}
      {jobs.length > 0 ? (
        <Body>
          전송 {progress.loaded}/{progress.total}
          {progress.failed > 0 ? ` · 실패 ${progress.failed}` : ''}
        </Body>
      ) : null}
      {jobs.map((job) => (
        <View key={job.id} style={styles.job}>
          <Text style={styles.jobTitle}>{job.name}</Text>
          <Body>
            {job.state === 'done' ? '완료' : job.state === 'confirming' ? '확인 중' : `${job.loaded}/${job.total}`}
          </Body>
          {job.message ? <Body>{job.message}</Body> : null}
          {canRetryTransfer(job.state) ? (
            <Button label="다시 시도" variant="secondary" onPress={() => void transfer(job).then(() => load())} />
          ) : null}
        </View>
      ))}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="아직 올린 사진·영상이 없습니다" description="모임 회원이면 이 행사에 여러 장을 올릴 수 있습니다." />
      ) : null}
      <View style={styles.grid}>
        {items.map((item) => (
          <MediaThumb key={item.id} groupId={groupId} item={item} onOpen={() => void open(item)} />
        ))}
      </View>
      {nextCursor ? <Button label="이전 사진 더 보기" variant="secondary" onPress={() => void loadMore()} /> : null}
      {viewer ? <MediaViewer kind={viewer.kind} uri={viewer.uri} onClose={() => setViewer(null)} /> : null}
    </View>
  );

  async function open(item: GatheringMediaView) {
    try {
      const download = await api.downloadMedia(groupId, item.id);
      setViewer({ uri: download.url, kind: item.kind });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '파일을 열지 못했습니다.');
    }
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

  async function refreshUpload(job: Job): Promise<'ready' | { uploadUrl: string; headers: Record<string, string> }> {
    if (!job.assetId) throw new Error('업로드 주소를 받지 못했습니다.');
    try {
      const resumed = await api.resumeMedia(groupId, eventId, job.assetId);
      if (resumed.status === 'READY') return 'ready';
      assignUpload(job, resumed);
      return { uploadUrl: resumed.uploadUrl, headers: resumed.headers };
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'UPLOAD_FAILED' || error.code === 'UPLOAD_EXPIRED')) {
        job.assetId = undefined;
        job.uploadUrl = undefined;
        job.headers = undefined;
        job.expiresAt = undefined;
        updateJob(job.id, { assetId: undefined, uploadUrl: undefined, headers: undefined, expiresAt: undefined });
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
  onOpen,
}: {
  groupId: string;
  item: GatheringMediaView;
  onOpen: () => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (item.kind !== 'PHOTO') return;
    let active = true;
    void api.downloadMedia(groupId, item.id).then((result) => {
      if (active) setUri(result.url);
    }).catch(() => {
      if (active) setUri(null);
    });
    return () => {
      active = false;
    };
  }, [groupId, item.id, item.kind]);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel="확대 보기" onPress={onOpen} style={styles.cell}>
      {uri ? <Image source={{ uri }} style={styles.thumb} /> : <Text style={styles.cellLabel}>{item.kind === 'VIDEO' ? '영상' : '사진'}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[12] },
  job: { gap: theme.space[8], paddingVertical: theme.space[8] },
  jobTitle: { ...theme.typography.body, color: theme.colors.text.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8] },
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
