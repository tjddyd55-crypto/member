import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      opacity.stopAnimation();
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      }, 1800);
    },
    [opacity],
  );
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      opacity.stopAnimation();
    },
    [opacity],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="none" style={styles.layer}>
        <Animated.View
          style={[
            styles.toast,
            {
              opacity,
              transform: [
                { translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
              ],
            },
          ]}
        >
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {message}
          </Text>
        </Animated.View>
      </View>
    </ToastContext.Provider>
  );
}
const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, top: '56%', alignItems: 'center', zIndex: 1000 },
  toast: {
    backgroundColor: 'rgba(20,24,30,0.85)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  text: { color: '#fff', fontSize: 14 },
});
