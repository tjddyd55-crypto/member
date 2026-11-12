import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { downloadFileName } from './viewer-values';

type Transform = { scale: number; x: number; y: number };
const ORIGINAL: Transform = { scale: 1, x: 0, y: 0 };
export function MediaViewer({
  uri,
  kind,
  fileName,
  onClose,
  onPrevious,
  onNext,
}: {
  uri: string;
  kind: 'PHOTO' | 'VIDEO';
  fileName?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const [transform, setTransform] = useState(ORIGINAL);
  const current = useRef(ORIGINAL);
  const base = useRef(ORIGINAL);
  const size = useRef({ width: 1, height: 1 });
  const pinch = useRef(0);
  const wasPinch = useRef(false);
  const callbacks = useRef({ onPrevious, onNext });
  callbacks.current = { onPrevious, onNext };
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = (next: Transform) => {
    current.current = next;
    setTransform(next);
  };
  useEffect(() => {
    update(ORIGINAL);
    setMessage('');
  }, [uri]);
  const gestures = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) =>
          event.nativeEvent.touches.length > 1 ||
          (current.current.scale > 1 && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 5) ||
          (Math.abs(gesture.dx) > 25 && Math.abs(gesture.dx) > Math.abs(gesture.dy)),
        onPanResponderGrant: (event) => {
          const [a, b] = event.nativeEvent.touches;
          pinch.current = a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
          wasPinch.current = pinch.current > 0;
          base.current = current.current;
        },
        onPanResponderMove: (event, gesture) => {
          const [a, b] = event.nativeEvent.touches;
          if (a && b) {
            const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            if (!pinch.current) {
              pinch.current = distance;
              base.current = current.current;
            }
            wasPinch.current = true;
            const scale = Math.max(
              1,
              Math.min(4, (base.current.scale * distance) / (pinch.current || 1)),
            );
            update({ scale, x: 0, y: 0 });
          } else if (current.current.scale > 1 && !wasPinch.current) {
            const maxX = (size.current.width * (current.current.scale - 1)) / 2;
            const maxY = (size.current.height * (current.current.scale - 1)) / 2;
            update({
              scale: current.current.scale,
              x: Math.max(-maxX, Math.min(maxX, base.current.x + gesture.dx)),
              y: Math.max(-maxY, Math.min(maxY, base.current.y + gesture.dy)),
            });
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!wasPinch.current && current.current.scale === 1) {
            if (gesture.dx < -60) callbacks.current.onNext?.();
            if (gesture.dx > 60) callbacks.current.onPrevious?.();
          }
          pinch.current = 0;
          wasPinch.current = false;
        },
        onPanResponderTerminate: () => {
          pinch.current = 0;
          wasPinch.current = false;
        },
      }),
    [],
  );
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
    <Modal animationType="fade" visible onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.toolbar}>
          <Control label="닫기" onPress={onClose} />
          <Control
            label={saving ? '저장 중' : '다운로드'}
            disabled={saving}
            onPress={() => void download()}
          />
        </View>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.label}>
            {message}
          </Text>
        ) : null}
        <View
          style={styles.stage}
          onLayout={(event) => {
            size.current = event.nativeEvent.layout;
          }}
          {...(kind === 'PHOTO' ? gestures.panHandlers : {})}
        >
          {kind === 'PHOTO' ? (
            <Image
              accessibilityLabel="사진 확대 보기"
              resizeMode="contain"
              source={{ uri }}
              style={[
                styles.photo,
                {
                  transform: [
                    { translateX: transform.x },
                    { translateY: transform.y },
                    { scale: transform.scale },
                  ],
                },
              ]}
            />
          ) : (
            <ClipPlayer uri={uri} />
          )}
        </View>
        <View style={styles.toolbar}>
          {onPrevious ? <Control label="이전" onPress={onPrevious} /> : null}
          {kind === 'PHOTO' ? (
            <Control
              label={transform.scale > 1 ? '원래 크기' : '확대'}
              onPress={() => update(transform.scale > 1 ? ORIGINAL : { ...ORIGINAL, scale: 2 })}
            />
          ) : null}
          {onNext ? <Control label="다음" onPress={onNext} /> : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
function Control({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
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
  return <VideoView nativeControls player={player} style={styles.video} />;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0E1A2B' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
  control: { padding: 12, minHeight: 48 },
  label: { color: '#FFFFFF', fontSize: 16 },
  stage: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  video: { width: '100%', height: 280 },
});
