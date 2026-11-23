import { useAppAlert } from '../../design/dialog';
import { albumCardDate } from './album-date';
import { useInvalidatedRefresh, useRefreshLoad } from '../../state/useInvalidatedRefresh';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type {
  GatheringAlbumItem,
  GatheringAlbumYear,
  GatheringAlbumFolder,
} from '@member/contracts';
import { api } from '../../api/client';
import { Body, Button, EmptyState, ErrorState, Notice, Screen, TextField } from '../../design/ui';
import { theme } from '../../theme';
import { useToast } from '../../design/toast';
import { folderDeletePrompt } from './folder-values';

type Folder = GatheringAlbumFolder;

export function AlbumsPane({ groupId }: { groupId: string }) {
  const [years, setYears] = useState<GatheringAlbumYear[]>([]);
  const [items, setItems] = useState<GatheringAlbumItem[]>([]);
  const { alert, dialog } = useAppAlert();
  const toast = useToast();
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [managing, setManaging] = useState(false);
  const [folderTitle, setFolderTitle] = useState('');
  const [year, setYear] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const read = useCallback(async () => {
    setMessage('');
    setFolderError(null);
    setRenameError('');
    setStatus('loading');
    try {
      const result = await api.albums(groupId, year ?? undefined);
      setYears(result.years);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '앨범을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId, year]);
  const load = useRefreshLoad(read);

  useInvalidatedRefresh(groupId, 'media', load);
  useEffect(() => {
    void load();
  }, [load, year]);

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      {dialog}
      {folderError ? <Body>{folderError}</Body> : null}
      {message ? <Notice>{message}</Notice> : null}
      <View style={styles.years}>
        <YearChip label="전체" selected={year == null} onPress={() => setYear(null)} />
        {years.map((item) => (
          <YearChip
            key={item.year}
            label={`${item.year}`}
            selected={year === item.year}
            onPress={() => setYear(item.year)}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TextField label="새 폴더 이름" value={folderTitle} onChangeText={setFolderTitle} />
        </View>
        <Button label="폴더 만들기" variant="secondary" onPress={() => void createFolder()} />
      </View>
      {items.map((item) => {
        if (item.type === 'event') {
          const event = item;
          return (
            <Pressable
              key={`event:${event.eventId}`}
              accessibilityRole="button"
              onPress={() => router.push(`/(app)/groups/${groupId}/albums/event/${event.eventId}`)}
              style={styles.card}
            >
              <View style={styles.heading}>
                <Text style={[styles.badge, styles.eventBadge]}>행사</Text>
                <Text numberOfLines={1} style={[styles.title, { flexShrink: 1 }]}>
                  {event.title}
                </Text>
              </View>
              <Body>
                {albumCardDate(event.startsAt)} · 사진 {event.photoCount} · 영상 {event.videoCount}
              </Body>
            </Pressable>
          );
        }
        const folder = item;
        return (
          <Pressable
            key={`folder:${folder.folderId}`}
            accessibilityRole="button"
            onPress={() => router.push(`/(app)/groups/${groupId}/folders/${folder.folderId}`)}
            style={styles.card}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={styles.heading}>
                <Text style={[styles.badge, styles.folderBadge]}>폴더</Text>
                <Text numberOfLines={1} style={[styles.title, { flexShrink: 1 }]}>
                  {folder.title}
                </Text>
              </View>
              {folder.canManage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${folder.title} 관리`}
                  disabled={managing}
                  style={{ padding: 8 }}
                  onPress={(event) => {
                    event.stopPropagation();
                    alert(folder.title, undefined, [
                      {
                        text: '이름 변경',
                        onPress: () => {
                          setRenameTitle(folder.title);
                          setRenameError('');
                          setRenaming(folder);
                        },
                      },
                      {
                        text: '삭제',
                        style: 'destructive',
                        onPress: () => confirmDeleteFolder(folder),
                      },
                      { text: '취소', style: 'cancel' },
                    ]);
                  }}
                >
                  <Text style={styles.title}>⋯</Text>
                </Pressable>
              ) : null}
            </View>
            <Body>
              {albumCardDate(folder.createdAt)} · 사진 {folder.photoCount} · 영상{' '}
              {folder.videoCount}
            </Body>
          </Pressable>
        );
      })}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="앨범이 비어 있습니다" />
      ) : null}
      {renaming ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={() => {
            if (!managing) setRenaming(null);
          }}
        >
          <Screen modal>
            <Text style={styles.title}>폴더 이름 변경</Text>
            <TextField
              label="폴더 이름"
              value={renameTitle}
              onChangeText={setRenameTitle}
              maxLength={80}
            />
            {renameError ? <Notice>{renameError}</Notice> : null}
            <Button
              label="저장"
              loading={managing}
              disabled={!renameTitle.trim()}
              onPress={() => void renameFolder()}
            />
            <Button
              label="취소"
              disabled={managing}
              variant="text"
              onPress={() => setRenaming(null)}
            />
          </Screen>
        </Modal>
      ) : null}
    </View>
  );

  async function renameFolder() {
    if (!renaming || managing) return;
    setManaging(true);
    setRenameError('');
    try {
      await api.renameFolder(groupId, renaming.folderId, renameTitle);
      setRenaming(null);
      toast('저장되었습니다.');
      await load();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : '이름을 변경하지 못했습니다.');
    } finally {
      setManaging(false);
    }
  }

  function confirmDeleteFolder(folder: Folder) {
    alert(folderDeletePrompt(folder), undefined, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          setManaging(true);
          void api
            .deleteFolder(groupId, folder.folderId)
            .then(async () => {
              toast('삭제되었습니다.');
              await load();
            })
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : '폴더를 삭제하지 못했습니다.'),
            )
            .finally(() => setManaging(false));
        },
      },
    ]);
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

function YearChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
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
  card: {
    gap: theme.space[8],
    padding: theme.space[12],
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
  },
  cardOn: { borderWidth: 2, borderColor: '#1B3A6B' },
  heading: {
    flexDirection: 'row',
    minHeight: 44,
    alignItems: 'center',
    gap: theme.space[8],
    flexShrink: 1,
  },
  badge: {
    ...theme.typography.caption,
    paddingHorizontal: theme.space[8],
    paddingVertical: theme.space[4],
    borderRadius: theme.radius[8],
  },
  eventBadge: { backgroundColor: theme.colors.primary.soft, color: theme.colors.primary.default },
  folderBadge: { backgroundColor: theme.colors.bg.default, color: theme.colors.text.secondary },
  hint: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  title: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
});
