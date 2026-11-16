import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, type AlertButton } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { Body, Button, Title } from './ui';

type Dialog = { title: string; message?: string; buttons: AlertButton[] };

export function useAppAlert() {
  const [current, setCurrent] = useState<Dialog | null>(null);
  const dismiss = () => {
    const cancel = current?.buttons.find((button) => button.style === 'cancel');
    setCurrent(null);
    cancel?.onPress?.();
  };
  return {
    alert: (title: string, message?: string, buttons: AlertButton[] = [{ text: '확인' }]) =>
      setCurrent({ title, message, buttons }),
    dialog: current ? (
      <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
        <SafeAreaView style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.card}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Title>{current.title}</Title>
              {current.message ? <Body>{current.message}</Body> : null}
              {current.buttons.map((button, index) => (
                <Button
                  key={index}
                  label={button.text ?? '확인'}
                  variant={button.style === 'cancel' ? 'text' : 'secondary'}
                  onPress={() => {
                    setCurrent(null);
                    button.onPress?.();
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    ) : null,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.layout.horizontalGutter,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  card: { maxHeight: '85%', borderRadius: theme.radius[12], backgroundColor: theme.colors.bg.default },
  content: { padding: theme.space[12], gap: theme.space[8] },
});
