import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardMetrics,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DISCLAIMER } from '../copy';
import {
  keyboardAvoidingBehavior,
  keyboardBottomPadding,
  keyboardScrollDelta,
} from '../features/forms/values';
import { useUnderAppChrome } from '../features/group/AppChrome';
import { theme } from '../theme';

type FormScroll = (input: TextInput | null) => void;

const FormScrollContext = createContext<FormScroll | null>(null);

function useKeyboardFrame() {
  const [frame, setFrame] = useState<KeyboardMetrics | undefined>(() => Keyboard.metrics?.());
  useEffect(() => {
    const show = (event: { endCoordinates: KeyboardMetrics }) => setFrame(event.endCoordinates);
    const hide = () => setFrame(undefined);
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', show),
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardWillHide', hide),
      Keyboard.addListener('keyboardDidHide', hide),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return frame;
}

export function KeyboardSheet({ children }: { children: React.ReactNode }) {
  const keyboard = useKeyboardFrame();
  const containerRef = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const updateOverlap = useCallback(() => {
    if (!keyboard) {
      setOverlap(0);
      return;
    }
    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      const obscuredHeight = Math.max(0, y + height - keyboard.screenY);
      setOverlap(Math.min(keyboard.height, obscuredHeight));
    });
  }, [keyboard]);

  useEffect(() => {
    const frame = requestAnimationFrame(updateOverlap);
    return () => cancelAnimationFrame(frame);
  }, [updateOverlap]);

  return (
    <View ref={containerRef} collapsable={false} onLayout={updateOverlap} style={styles.sheetBackdrop}>
      <View style={[styles.sheetContent, { marginBottom: keyboard ? overlap : 0 }]}>
        {children}
      </View>
    </View>
  );
}

export function Screen({
  children,
  header,
  footer,
  modal = false,
  scrollKey,
  scroll = true,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  modal?: boolean;
  scrollKey?: string;
  scroll?: boolean;
}) {
  const underChrome = useUnderAppChrome();
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const viewportRef = useRef<View>(null);
  const focusedInput = useRef<TextInput>(null);
  const scrollOffset = useRef(0);
  const keyboard = useKeyboardFrame();

  const revealFocusedInput = useCallback(() => {
    const input = focusedInput.current;
    const viewport = viewportRef.current;
    if (!input?.isFocused() || !viewport) return;
    viewport.measureInWindow((_x, viewportY, _width, viewportHeight) => {
      if (!viewportHeight || !input.isFocused()) return;
      const viewportBottom = viewportY + viewportHeight;
      const scrollToReveal = (fieldBottom: number) => {
        if (focusedInput.current !== input || !input.isFocused()) return;
        const delta = keyboardScrollDelta(fieldBottom, viewportBottom, keyboard?.screenY);
        if (delta > 0) {
          scrollRef.current?.scrollTo({ y: scrollOffset.current + delta, animated: true });
        }
      };

      input.measureInWindow((_fieldX, fieldY, _fieldWidth, fieldHeight) => {
        if (fieldHeight > 0 && Number.isFinite(fieldY)) {
          scrollToReveal(fieldY + fieldHeight);
        } else if (contentRef.current) {
          input.measureLayout(
            contentRef.current,
            (_left, top, _inputWidth, height) =>
              scrollToReveal(viewportY + top + height - scrollOffset.current),
            () => undefined,
          );
        }
      });
    });
  }, [keyboard]);

  useEffect(() => {
    if (scrollKey !== undefined) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollKey]);

  useEffect(() => {
    const frame = requestAnimationFrame(revealFocusedInput);
    return () => cancelAnimationFrame(frame);
  }, [revealFocusedInput]);

  const formScroll = useMemo<FormScroll>(
    () => (input) => {
      focusedInput.current = input;
      revealFocusedInput();
    },
    [revealFocusedInput],
  );
  return (
    <SafeAreaView
      style={styles.safe}
      edges={
        underChrome && !modal ? ['left', 'right', 'bottom'] : ['top', 'left', 'right', 'bottom']
      }
    >
      <KeyboardAvoidingView behavior={keyboardAvoidingBehavior(Platform.OS)} style={styles.flex}>
        {header ? <View style={styles.header}>{header}</View> : null}
        <FormScrollContext.Provider value={formScroll}>
          {scroll ? (
            <View
              ref={viewportRef}
              collapsable={false}
              style={styles.flex}
              onLayout={revealFocusedInput}
            >
              <ScrollView
                ref={scrollRef}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                scrollEventThrottle={16}
                onScroll={(event) => {
                  scrollOffset.current = event.nativeEvent.contentOffset.y;
                }}
                onContentSizeChange={revealFocusedInput}
                contentContainerStyle={[
                  styles.flexGrow,
                  { paddingBottom: keyboardBottomPadding(keyboard?.height ?? 0) },
                ]}
              >
                <View ref={contentRef} collapsable={false} style={styles.content}>
                  {children}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={[styles.content, styles.flex, { paddingBottom: theme.space[16] }]}>
              {children}
            </View>
          )}
        </FormScrollContext.Provider>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.error}>{children}</Text>
    </View>
  );
}

export function Disclaimer() {
  return <Text style={styles.disclaimer}>{DISCLAIMER}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  loading?: boolean;
}) {
  const secondary = variant === 'secondary' || variant === 'text';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && {
          backgroundColor: pressed ? theme.colors.primary.pressed : theme.colors.primary.default,
        },
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'text' && styles.buttonText,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={secondary ? theme.colors.primary.default : theme.colors.text.onPrimary}
        />
      ) : (
        <Text style={[styles.buttonLabel, secondary && { color: theme.colors.primary.default }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  onFocus,
  ref,
  ...props
}: TextInputProps & { label: string; error?: string; ref?: React.Ref<TextInput> }) {
  const formScroll = useContext(FormScrollContext);
  const inputRef = useRef<TextInput>(null);
  const attachInput = useCallback((input: TextInput | null) => {
    inputRef.current = input;
    if (typeof ref === 'function') return ref(input);
    if (ref) ref.current = input;
  }, [ref]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={attachInput}
        placeholderTextColor={theme.colors.text.disabled}
        style={[styles.input, error ? styles.inputError : null]}
        onFocus={(event) => {
          onFocus?.(event);
          formScroll?.(inputRef.current);
        }}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.section}>{title}</Text>
      {description ? <Body>{description}</Body> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stack}>
      <Text style={[styles.section, { color: theme.colors.status.error }]}>
        불러오지 못했습니다
      </Text>
      <Body>{message}</Body>
      <Button label="다시 시도" onPress={onRetry} />
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.colors.primary.default} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg.default },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: '#0006' },
  sheetContent: { flex: 1, justifyContent: 'flex-end' },
  header: { paddingHorizontal: theme.layout.horizontalGutter, paddingTop: 8, gap: 8 },
  content: {
    padding: theme.layout.horizontalGutter,
    gap: theme.space[16],
  },
  title: { ...theme.typography.display, color: theme.colors.text.primary },
  section: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
  body: { ...theme.typography.body, color: theme.colors.text.secondary },
  disclaimer: { ...theme.typography.caption, color: theme.colors.text.secondary },
  button: {
    minHeight: theme.layout.buttonMinHeight,
    borderRadius: theme.radius[12],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.layout.horizontalGutter,
  },
  buttonSecondary: { backgroundColor: theme.colors.primary.soft },
  buttonText: { backgroundColor: 'transparent' },
  buttonLabel: { ...theme.typography.button, color: theme.colors.text.onPrimary },
  disabled: { opacity: 0.5 },
  field: { gap: theme.space[8] },
  label: { ...theme.typography.bodySmall, color: theme.colors.text.primary, fontWeight: '500' },
  input: {
    minHeight: theme.layout.inputMinHeight,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.layout.horizontalGutter,
    ...theme.typography.body,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.bg.default,
  },
  formError: {
    backgroundColor: theme.colors.bg.danger,
    borderRadius: theme.radius[12],
    padding: theme.space[12],
  },
  inputError: { borderColor: theme.colors.status.error },
  error: { ...theme.typography.bodySmall, color: theme.colors.status.error },
  notice: {
    backgroundColor: theme.colors.bg.subtle,
    borderRadius: theme.radius[12],
    padding: theme.space[12],
  },
  noticeText: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  stack: { gap: theme.space[12] },
  loading: { paddingVertical: theme.space[32], alignItems: 'center' },
});
