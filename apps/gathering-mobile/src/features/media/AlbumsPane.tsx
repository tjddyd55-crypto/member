import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import type { GatheringAlbumEvent, GatheringAlbumYear } from '@member/contracts';
import { api } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice, TextField } from '../../design/ui';
import { theme } from '../../theme';
import { prepareAsset, putPreparedFile } from './prepare';
import { uploadBlockReason } from './upload-block';

type Destination =
  | { kind: 'event'; id: string; title: string }
  | { kind: 'folder'; id: string; title: string };

export function AlbumsPane({ groupId }: { groupId: string }) {
  const [years, setYears] = useState<GatheringAlbumYear[]>([]);
  const [events, setEvents] = useState<GatheringAlbumEvent[]>([]);
  const [folders, setFolders] = useState<Array<{ folderId: string; title: string; photoCount: number; videoCount: number }>>([]);
  const [folderTitle, setFolderTitle] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [uploadsAllowed, setUploadsAllowed] = useState(true);
  const [handoverStatus, setHandoverStatus] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [result, subscription, handover] = await Promise.all([
        api.albums(groupId, year ?? undefined),
        api.subscription(groupId).catch(() => null),
        api.handover(groupId).catch(() => null),
      ]);
      setYears(result.years);
      setEvents(result.events);
      setFolders(result.folders ?? []);
      setUploadsAllowed(subscription?.uploadsAllowed ?? false);
      setHandoverStatus(handover?.handover?.status ?? null);
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
  const blockReason = uploadBlockReason({
    handoverStatus,
    uploadsAllowed,
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
    try {
      const files = [];
      for (const asset of picked.assets) {
        const file = await prepareAsset(asset);
        if (file.kind === kind) files.push(file);
      }
      if (files.length === 0) {
        setMessage(kind === 'PHOTO' ? '사진 파일을 고르지 않았습니다.' : '영상 파일을 고르지 않았습니다.');
        return;
      }
      const reserved =
        destination.kind === 'event'
          ? await api.createMediaUploads(groupId, destination.id, files)
          : await api.createFolderUploads(groupId, destination.id, files);
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const target = reserved.items[index];
        if (!file || !target) continue;
        await putPreparedFile(file.uri, target.uploadUrl, target.headers, () => undefined);
        if (destination.kind === 'event') {
          await api.completeMedia(groupId, destination.id, target.id, file.sizeBytes);
        } else {
          await api.completeFolderMedia(groupId, destination.id, target.id, file.sizeBytes);
        }
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '올리지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <Button label="사진 올리기" disabled={Boolean(blockReason) || busy} onPress={() => void upload('PHOTO')} />
      <Button label="영상 올리기" disabled={Boolean(blockReason) || busy} onPress={() => void upload('VIDEO')} />
      {blockReason ? <Notice>{blockReason}</Notice> : null}
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
