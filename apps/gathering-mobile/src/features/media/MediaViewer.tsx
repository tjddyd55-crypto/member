import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Gallery } from 'react-native-zoom-toolkit';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { downloadFileName } from './viewer-values';

export type ViewerItem = { id: string; kind: 'PHOTO' | 'VIDEO'; uri?: string; fileName?: string };

// A single-item invocation is retained for the existing receipt preview.
export function MediaViewer(props: {
  uri?: string;
  kind?: 'PHOTO' | 'VIDEO';
  fileName?: string;
  items?: ViewerItem[];
  initialIndex?: number;
  resolveUri?: (item: ViewerItem) => Promise<string>;
  onClose: () => void;
}) {
  const items = props.items ?? [
    { id: 'receipt', uri: props.uri, kind: props.kind ?? 'PHOTO', fileName: props.fileName },
  ];
  const [index, setIndex] = useState(props.initialIndex ?? 0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const item = items[index];
  const uri = item.uri ?? urls[item.id] ?? '';
  const { kind, fileName } = item;
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    setMessage('');
  }, [index]);
  const remember = (id: string, url: string) =>
    setUrls((current) => (current[id] === url ? current : { ...current, [id]: url }));
  const download = async () => {
    if (savingRef.current) return;
    if (Platform.OS === 'web') {
      await Linking.openURL(uri).catch(() => setMessage('다운로드를 열지 못했습니다.'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let temporary: string | undefined;
    try {
      const cache = FileSystem.cacheDirectory;
      if (!cache) throw new Error('CACHE_UNAVAILABLE');
      const target = `${cache}JCI-${Date.now()}.${kind === 'VIDEO' ? 'mp4' : 'jpg'}`;
      temporary = target;
      const result = await FileSystem.downloadAsync(uri, target);
      if (result.status < 200 || result.status >= 300) throw new Error('DOWNLOAD_FAILED');
      const name = downloadFileName(fileName, result.mimeType, kind);
      if (Platform.OS === 'android') {
        const directory =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!directory.granted) return;
        const mime = result.mimeType ?? (kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg');
        const file = await FileSystem.StorageAccessFramework.createFileAsync(
          directory.directoryUri,
          name,
          mime,
        );
        const data = await FileSystem.readAsStringAsync(result.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.writeAsStringAsync(file, data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setMessage('저장했습니다.');
      } else {
        const renamed = `${cache}${Date.now()}-${name}`;
        await FileSystem.moveAsync({ from: result.uri, to: renamed });
        temporary = renamed;
        await Share.share({ url: renamed });
      }
    } catch {
      setMessage('다운로드하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (temporary)
        await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal animationType="fade" visible onRequestClose={props.onClose}>
      <GestureHandlerRootView style={styles.backdrop}>
        <SafeAreaView style={styles.backdrop}>
          <View style={styles.toolbar}>
            <Text style={styles.label}>
              {index + 1} / {items.length}
            </Text>
            <View style={styles.actions}>
              <Control
                label={saving ? '저장 중' : '↓'}
                accessibilityLabel="다운로드"
                disabled={saving || !uri}
                onPress={() => void download()}
              />
              <Control label="✕" accessibilityLabel="닫기" onPress={props.onClose} />
            </View>
          </View>
          <View style={styles.stage} onLayout={(event) => setSize(event.nativeEvent.layout)}>
            <Gallery
              data={items}
              initialIndex={props.initialIndex ?? 0}
              keyExtractor={(entry) => entry.id}
              onIndexChange={setIndex}
              zoomEnabled={kind === 'PHOTO'}
              tapOnEdgeToItem={false}
              maxScale={4}
              windowSize={3}
              renderItem={(entry, position) => (
                <GalleryAsset
                  item={entry}
                  position={position}
                  size={size}
                  resolveUri={props.resolveUri}
                  remember={remember}
                />
              )}
            />
            {kind === 'VIDEO' && uri ? <ClipPlayer key={item.id} uri={uri} /> : null}
          </View>
          {message ? (
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {message}
            </Text>
          ) : null}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function GalleryAsset({
  item,
  position,
  size,
  resolveUri,
  remember,
}: {
  item: ViewerItem;
  position: number;
  size: { width: number; height: number };
  resolveUri?: (item: ViewerItem) => Promise<string>;
  remember: (id: string, uri: string) => void;
}) {
  const [uri, setUri] = useState(item.uri ?? '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (item.uri) {
      remember(item.id, item.uri);
      return;
    }
    void resolveUri?.(item)
      .then((url) => {
        if (active) {
          setUri(url);
          remember(item.id, url);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
    // URI requests belong to an item, not render callback identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.uri]);
  return (
    <View style={size}>
      {item.kind === 'PHOTO' && uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={`사진 ${position + 1}`}
          resizeMode="contain"
          style={styles.photo}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.message}>
          {failed
            ? '미디어를 열지 못했습니다. 닫고 다시 시도해 주세요.'
            : item.kind === 'VIDEO'
              ? `영상 ${position + 1}`
              : '불러오는 중…'}
        </Text>
      )}
      {failed && item.kind === 'PHOTO' ? (
        <Text style={styles.message}>사진을 열지 못했습니다. 닫고 다시 시도해 주세요.</Text>
      ) : null}
    </View>
  );
}
function Control({
  label,
  accessibilityLabel = label,
  onPress,
  disabled,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={styles.control}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
function ClipPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const subscription = player.addListener('playingChange', (event) =>
      setPlaying(event.isPlaying),
    );
    return () => subscription.remove();
  }, [player]);
  // The video surface passes gestures through to Gallery; only playback buttons consume touches.
  // Unmounting on index change releases the player via useVideoPlayer.
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" style={styles.stage}>
        <VideoView
          nativeControls={false}
          player={player}
          style={styles.photo}
          contentFit="contain"
        />
      </View>
      <View pointerEvents="box-none" style={styles.playback}>
        <Control
          label="−10초"
          onPress={() => {
            player.currentTime = Math.max(0, player.currentTime - 10);
          }}
        />
        <Control
          label={playing ? '일시정지' : '재생'}
          onPress={() => (playing ? player.pause() : player.play())}
        />
        <Control
          label="+10초"
          onPress={() => {
            player.currentTime = Math.min(player.duration, player.currentTime + 10);
          }}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 4,
  },
  actions: { flexDirection: 'row' },
  control: { padding: 12, minHeight: 48, minWidth: 48, alignItems: 'center' },
  label: { color: '#fff', fontSize: 16 },
  message: { color: '#fff', textAlign: 'center', padding: 8 },
  stage: { flex: 1, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  playback: { flexDirection: 'row', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
});
