import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringMediaView } from '@member/contracts';
import { api } from '../../../../../src/api/client';
import { Body, Button, EmptyState, ErrorState, LoadingState, Screen, Title } from '../../../../../src/design/ui';
import { MediaViewer } from '../../../../../src/features/media/MediaViewer';
import { theme } from '../../../../../src/theme';

export default function FolderMediaScreen() {
  const params = useLocalSearchParams<{ groupId: string; folderId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const folderId = typeof params.folderId === 'string' ? params.folderId : '';
  const [title, setTitle] = useState('사진 폴더');
  const [items, setItems] = useState<GatheringMediaView[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [viewer, setViewer] = useState<{ uri: string; kind: 'PHOTO' | 'VIDEO' } | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await api.folderMedia(groupId, folderId);
      setTitle(result.folder.title);
      setItems(result.items);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '폴더를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [folderId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: GatheringMediaView) => {
    try {
      const download = await api.downloadMedia(groupId, item.id);
      setViewer({ uri: download.url, kind: item.kind });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '파일을 열지 못했습니다.');
    }
  };

  return (
    <Screen>
      <Button label="앨범으로" variant="text" onPress={() => router.back()} />
      <Title>{title}</Title>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {message && status === 'ready' ? <Body>{message}</Body> : null}
      {status === 'ready' && items.length === 0 ? (
        <EmptyState title="올린 파일이 없습니다" description="업로드 링크로 올린 사진과 영상이 여기에 보입니다." />
      ) : null}
      <View style={styles.list}>
        {items.map((item) => (
          <Pressable key={item.id} accessibilityRole="button" onPress={() => void open(item)} style={styles.row}>
            <Text style={styles.name}>{item.kind === 'VIDEO' ? '영상' : '사진'}</Text>
            <Body>{item.kind === 'VIDEO' ? '영상 보기' : '사진 보기'}</Body>
          </Pressable>
        ))}
      </View>
      {viewer ? <MediaViewer kind={viewer.kind} uri={viewer.uri} onClose={() => setViewer(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: theme.space[12] },
  row: { gap: theme.space[4], paddingVertical: theme.space[8] },
  name: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
});
