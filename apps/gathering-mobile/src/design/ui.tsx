import React, { createContext, useContext, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DISCLAIMER } from '../copy';
import { focusedFieldScrollY, keyboardAvoidingBehavior } from '../features/forms/values';
import { theme } from '../theme';

type FormScroll = {
  contentRef: React.RefObject<View | null>;
  scrollTo: (y: number) => void;
};

const FormScrollContext = createContext<FormScroll | null>(null);

export function Screen({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const formScroll = useMemo<FormScroll>(
    () => ({
      contentRef,
      scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: true }),
    }),
    [],
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={keyboardAvoidingBehavior(Platform.OS)} style={styles.flex}>
        <FormScrollContext.Provider value={formScroll}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.flexGrow}
          >
            <View ref={contentRef} collapsable={false} style={styles.content}>
              {children}
            </View>
          </ScrollView>
        </FormScrollContext.Provider>
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
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const formScroll = useContext(FormScrollContext);
  const fieldRef = useRef<View>(null);
  return (
    <View ref={fieldRef} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.colors.text.disabled}
        style={[styles.input, error ? styles.inputError : null]}
        onFocus={(event) => {
          onFocus?.(event);
          const field = fieldRef.current;
          const content = formScroll?.contentRef.current;
          if (!field || !content || !formScroll) return;
          field.measureLayout(
            content,
            (_x, y) => formScroll.scrollTo(focusedFieldScrollY(y)),
            () => undefined,
          );
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

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.stack}>
      <Text style={styles.section}>{title}</Text>
      <Body>{description}</Body>
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
  content: {
    padding: theme.layout.horizontalGutter,
    gap: theme.space[16],
    paddingBottom: 120,
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
    paddingHorizontal: theme.space[16],
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
    paddingHorizontal: theme.space[16],
    ...theme.typography.body,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.bg.default,
  },
  inputError: { borderColor: theme.colors.status.error },
  error: { ...theme.typography.bodySmall, color: theme.colors.status.error },
  notice: {
    backgroundColor: theme.colors.bg.subtle,
    borderRadius: theme.radius[12],
    padding: theme.space[16],
  },
  noticeText: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  stack: { gap: theme.space[12] },
  loading: { paddingVertical: theme.space[32], alignItems: 'center' },
});
