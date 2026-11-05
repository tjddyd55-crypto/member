import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import type { GatheringAlbumEvent, GatheringAlbumYear } from '@member/contracts';
import { api } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice, TextField } from '../../design/ui';
import { theme } from '../../theme';
import { signedUrlStillFresh } from '@member/gathering-domain';
import { SUBSCRIPTION_RETRY_HINT, subscriptionUploadState, uploadAlbumFiles } from './album-upload';
import { prepareAsset, putPreparedFile, type PreparedUpload } from './prepare';
import { uploadBlockReason } from './upload-block';

type Destination =
  | { kind: 'event'; id: string; title: string }
  | { kind: 'folder'; id: string; title: string };

type FailedUpload = {
  key: string;
  name: string;
  file: PreparedUpload;
  destination: Destination;
  assetId?: string;
  uploadUrl?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
  message?: string;
};

export function AlbumsPane({ groupId }: { groupId: string }) {
  const [years, setYears] = useState<GatheringAlbumYear[]>([]);
  const [events, setEvents] = useState<GatheringAlbumEvent[]>([]);
  const [folders, setFolders] = useState<Array<{ folderId: string; title: string; photoCount: number; videoCount: number }>>([]);
  const [folderTitle, setFolderTitle] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [uploadsAllowed, setUploadsAllowed] = useState<boolean | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedUploads, setFailedUploads] = useState<FailedUpload[]>([]);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [result, subscription] = await Promise.all([
        api.albums(groupId, year ?? undefined),
        api.subscription(groupId).then(
          (value) => value,
          () => null,
        ),
      ]);
      setYears(result.years);
      setEvents(result.events);
      setFolders(result.folders ?? []);
      setUploadsAllowed(subscription ? subscription.uploadsAllowed : null);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '앨범을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const destinationCount = events.length + folders.length;
  const subscriptionState = subscriptionUploadState(uploadsAllowed);
  const blockReason = uploadBlockReason({
    uploadsAllowed: subscriptionState !== 'inactive',
    destinationCount,
    destinationChosen: destination != null,
  });

  const upload = async (kind: 'PHOTO' | 'VIDEO') => {
    if (!destination || blockReason) return;
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
    setBusy(true);
    setMessage('');
    const files: FailedUpload[] = [];
    for (const asset of picked.assets) {
      try {
        const file = await prepareAsset(asset);
        if (file.kind !== kind) continue;
        files.push({
          key: `${destination.kind}:${destination.id}:${files.length}:${file.originalName ?? kind}`,
          name: file.originalName ?? (kind === 'PHOTO' ? '사진' : '영상'),
          file,
          destination,
        });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '파일을 준비하지 못했습니다.');
      }
    }
    if (files.length === 0) {
      setBusy(false);
      setMessage(kind === 'PHOTO' ? '사진 파일을 고르지 않았습니다.' : '영상 파일을 고르지 않았습니다.');
      return;
    }
    try {
      const failed = await sendAlbumFiles(files);
      setFailedUploads((current) => {
        const keys = new Set(files.map((file) => file.key));
        return [...current.filter((entry) => !keys.has(entry.key)), ...failed];
      });
      if (failed.length > 0) {
        setMessage(`${failed.length}개를 올리지 못했습니다. 다시 시도는 같은 업로드를 이어 받습니다.`);
      }
    } finally {
      setBusy(false);
      await load();
    }
  };

  const retryUpload = async (item: FailedUpload) => {
    setBusy(true);
    setMessage('');
    try {
      const failed = await sendAlbumFiles([item]);
      setFailedUploads((current) => [...current.filter((entry) => entry.key !== item.key), ...failed]);
      if (failed.length > 0) setMessage('다시 올리지 못했습니다. 같은 업로드로 한 번 더 시도할 수 있습니다.');
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <Button label="사진 올리기" disabled={Boolean(blockReason) || busy} onPress={() => void upload('PHOTO')} />
      <Button label="영상 올리기" disabled={Boolean(blockReason) || busy} onPress={() => void upload('VIDEO')} />
      {blockReason ? <Notice>{blockReason}</Notice> : null}
      {status === 'ready' && subscriptionState === 'unknown' ? (
        <>
          <Notice>{SUBSCRIPTION_RETRY_HINT}</Notice>
          <Button label="이용 상태 다시 확인" variant="text" onPress={() => void load()} />
        </>
      ) : null}
      {failedUploads.map((item) => (
        <View key={item.key} style={styles.card}>
          <Text style={styles.title}>{item.name}</Text>
          <Body>{item.message ?? '올리지 못했습니다.'}</Body>
          <Button label="다시 시도" variant="secondary" disabled={busy} onPress={() => void retryUpload(item)} />
        </View>
      ))}
      {destination ? <Body>{`올리는 곳: ${destination.title}`}</Body> : <Body>아래에서 행사나 폴더를 고르세요.</Body>}
      <Button label="행사 만들기" variant="secondary" onPress={() => router.push(`/(app)/groups/${groupId}/events/new`)} />
      {folderError ? <Body>{folderError}</Body> : null}
      {message ? <Notice>{message}</Notice> : null}
      <View style={styles.years}>
        <YearChip label="전체" selected={year == null} onPress={() => setYear(null)} />
        {years.map((item) => (
          <YearChip key={item.year} label={`${item.year}`} selected={year === item.year} onPress={() => setYear(item.year)} />
        ))}
      </View>
      <TextField label="새 폴더 이름" value={folderTitle} onChangeText={setFolderTitle} />
      <Button label="폴더 만들기" variant="secondary" onPress={() => void createFolder()} />
      {folders.map((folder) => {
        const selected = destination?.kind === 'folder' && destination.id === folder.folderId;
        return (
          <Pressable
            key={folder.folderId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setDestination({ kind: 'folder', id: folder.folderId, title: folder.title })}
            style={[styles.card, selected && styles.cardOn]}
          >
            <Text style={styles.title}>{folder.title}</Text>
            <Body>사진 {folder.photoCount} · 영상 {folder.videoCount}</Body>
            <Button
              label="폴더 열기"
              variant="text"
              onPress={() => router.push(`/(app)/groups/${groupId}/folders/${folder.folderId}`)}
            />
          </Pressable>
        );
      })}
      {status === 'ready' && events.length === 0 && folders.length === 0 ? (
        <EmptyState title="앨범이 비어 있습니다" description="행사나 폴더를 만든 뒤 사진과 영상을 올릴 수 있습니다." />
      ) : null}
      {events.map((event) => {
        const selected = destination?.kind === 'event' && destination.id === event.eventId;
        return (
          <Pressable
            key={event.eventId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setDestination({ kind: 'event', id: event.eventId, title: event.title })}
            style={[styles.card, selected && styles.cardOn]}
          >
            <Text style={styles.title}>{event.title}</Text>
            <Body>사진 {event.photoCount} · 영상 {event.videoCount}</Body>
            <Button
              label="앨범 열기"
              variant="text"
              onPress={() => router.push(`/(app)/groups/${groupId}/events/${event.eventId}?tab=media`)}
            />
          </Pressable>
        );
      })}
    </View>
  );

  async function sendAlbumFiles(files: FailedUpload[]) {
    const failed: FailedUpload[] = [];
    const groups = new Map<string, FailedUpload[]>();
    for (const file of files) {
      const groupKey = `${file.destination.kind}:${file.destination.id}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), file]);
    }
    for (const group of groups.values()) {
      const target = group[0]?.destination;
      if (!target) continue;
      const outcomes = await uploadAlbumFiles({
        files: group,
        reserve: async (batch) => {
          const reserved =
            target.kind === 'event'
              ? await api.createMediaUploads(groupId, target.id, batch.map((item) => toIntent(item.file)))
              : await api.createFolderUploads(groupId, target.id, batch.map((item) => toIntent(item.file)));
          return batch.map((item, index) => {
            const created = reserved.items[index];
            return created
              ? {
                  key: item.key,
                  assetId: created.id,
                  uploadUrl: created.uploadUrl,
                  headers: created.headers,
                  expiresAt: created.expiresAt,
                }
              : { key: item.key, assetId: '' };
          });
        },
        send: async (item) => {
          const fresh =
            item.uploadUrl && item.headers && signedUrlStillFresh(item.expiresAt)
              ? { status: 'PENDING' as const, uploadUrl: item.uploadUrl, headers: item.headers }
              : await refreshUploadUrl(target, item.assetId);
          if (fresh.status === 'READY') return;
          await putPreparedFile(item.file.uri, fresh.uploadUrl, fresh.headers, () => undefined);
          if (target.kind === 'event') await api.completeMedia(groupId, target.id, item.assetId, item.file.sizeBytes);
          else await api.completeFolderMedia(groupId, target.id, item.assetId, item.file.sizeBytes);
        },
      });
      for (const outcome of outcomes) {
        if (outcome.ok) continue;
        const source = group.find((item) => item.key === outcome.key);
        if (!source) continue;
        failed.push({ ...source, assetId: outcome.assetId ?? source.assetId, message: outcome.message });
      }
    }
    return failed;
  }

  async function refreshUploadUrl(target: Destination, assetId: string) {
    if (target.kind === 'event') return api.resumeMedia(groupId, target.id, assetId);
    return api.resumeFolderMedia(groupId, target.id, assetId);
  }

  async function createFolder() {
    try {
      setFolderError(null);
      await api.createFolder(groupId, folderTitle);
      setFolderTitle('');
      await load();
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : '폴더를 만들지 못했습니다.');
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

function YearChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={{ color: selected ? '#FFFFFF' : '#1B3A6B' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[12] },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8] },
  chip: {
    minHeight: 36,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[12],
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.subtle,
  },
  chipOn: { backgroundColor: '#1B3A6B' },
  card: { gap: theme.space[8], padding: theme.space[12], borderRadius: theme.radius[12], backgroundColor: theme.colors.bg.subtle },
  cardOn: { borderWidth: 2, borderColor: '#1B3A6B' },
  title: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
});
