import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export function MediaViewer({
  uri,
  kind,
  onClose,
}: {
  uri: string;
  kind: 'PHOTO' | 'VIDEO';
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <Text style={styles.closeLabel}>닫기</Text>
        </Pressable>
        {kind === 'PHOTO' ? (
          <Image accessibilityLabel="확대 보기" resizeMode="contain" source={{ uri }} style={styles.photo} />
        ) : (
          <ClipPlayer uri={uri} />
        )}
      </View>
    </Modal>
  );
}

function ClipPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  return <VideoView nativeControls player={player} style={styles.video} />;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0E1A2B', justifyContent: 'center' },
  close: { position: 'absolute', top: 48, right: 20, zIndex: 1, padding: 12 },
  closeLabel: { color: '#FFFFFF', fontSize: 16 },
  photo: { width: '100%', height: '80%' },
  video: { width: '100%', height: 280 },
});
