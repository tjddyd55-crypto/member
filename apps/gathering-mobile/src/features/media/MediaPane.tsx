import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { GatheringMediaView } from '@member/contracts';
import { canRetryTransfer, summarizeTransfer, type TransferState } from '@member/gathering-domain';
import { api, ApiError } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice } from '../../design/ui';
import { theme } from '../../theme';
import { MediaViewer } from './MediaViewer';
import { prepareAsset, putPreparedFile, type PreparedUpload } from './prepare';

type Job = {
  id: string;
  name: string;
  state: TransferState;
  loaded: number;
  total: number;
  message: string;
  file: PreparedUpload;
};

export function MediaPane({ groupId, eventId }: { groupId: string; eventId: string }) {
  const [items, setItems] = useState<GatheringMediaView[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [uploadsAllowed, setUploadsAllowed] = useState(false);
  const [viewer, setViewer] = useState<{ uri: string; kind: 'PHOTO' | 'VIDEO' } | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [media, usage] = await Promise.all([api.eventMedia(groupId, eventId), api.storage(groupId)]);
      setItems(media.items);
      setUploadsAllowed(usage.subscriptionActive);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '사진·영상을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendOne = async (job: Job) => {
    updateJob(job.id, { state: 'uploading', message: '' });
    try {
      const created = await api.createMediaUploads(groupId, eventId, [toIntent(job.file)]);
      const target = created.items[0];
      if (!target) throw new Error('업로드 주소를 받지 못했습니다.');
      await putPreparedFile(job.file.uri, target.uploadUrl, target.headers, (loaded, total) => {
        updateJob(job.id, { loaded, total, state: 'uploading' });
      });
      updateJob(job.id, { state: 'confirming' });
      await api.completeMedia(groupId, eventId, target.id, job.file.sizeBytes);
      updateJob(job.id, { state: 'done', loaded: job.file.sizeBytes, total: job.file.sizeBytes });
    } catch (error) {
      updateJob(job.id, {
        state: 'failed',
        message: error instanceof ApiError ? error.message : error instanceof Error ? error.message : '업로드에 실패했습니다.',
      });
    }
  };

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('앨범 접근을 허용해야 사진·영상을 올릴 수 있습니다.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
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
    for (const job of next) await sendOne(job);
    await load();
  };

  const progress = summarizeTransfer(jobs);

  return (
    <View style={styles.stack}>
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {message ? <Notice>{message}</Notice> : null}
      {uploadsAllowed ? (
        <Button label="사진·영상 올리기" onPress={() => void pick()} />
      ) : (
        <Notice>지금은 새 사진·영상을 올릴 수 없습니다. 이미 올린 파일은 볼 수 있습니다.</Notice>
      )}
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
            <Button label="다시 시도" variant="secondary" onPress={() => void sendOne(job).then(() => load())} />
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
