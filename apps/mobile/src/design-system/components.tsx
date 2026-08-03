import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';

export function AppBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.appBar}>
      <Text style={styles.appBarTitle} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={{ width: 24 }} />}
    </View>
  );
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
  variant?: 'primary' | 'secondary' | 'danger' | 'text';
  disabled?: boolean;
  loading?: boolean;
}) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary && { backgroundColor: pressed ? theme.colors.primary.pressed : theme.colors.primary.default },
        variant === 'secondary' && styles.buttonSecondary,
        isDanger && { backgroundColor: theme.colors.status.error },
        variant === 'text' && styles.buttonTextVariant,
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'text' ? theme.colors.primary.default : '#fff'} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            (variant === 'secondary' || variant === 'text') && { color: theme.colors.primary.default },
            isDanger && { color: theme.colors.text.onPrimary },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: theme.space[8] }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.colors.text.disabled}
        style={[styles.input, error ? { borderColor: theme.colors.status.error } : null]}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function MemberCard({
  name,
  position,
  company,
  onPress,
}: {
  name: string;
  position?: string | null;
  company?: string | null;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {position || '직책 없음'}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {company || '직장 정보 없음'}
        </Text>
      </View>
    </Pressable>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.centerBox}>
      <Text style={styles.cardTitle}>{title}</Text>
      {description ? <Text style={styles.cardSub}>{description}</Text> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centerBox}>
      <Text style={[styles.cardTitle, { color: theme.colors.status.error }]}>오류</Text>
      <Text style={styles.cardSub}>{message}</Text>
      {onRetry ? <Button label="다시 시도" onPress={onRetry} /> : null}
    </View>
  );
}

export function Skeleton({ height = 72, style }: { height?: number; style?: ViewStyle }) {
  return <View style={[{ height, borderRadius: theme.radius[12], backgroundColor: theme.colors.bg.subtle }, style]} />;
}

export function ComingSoon() {
  return (
    <EmptyState
      title="다음 개발 단계에서 제공됩니다"
      description="현재 foundation 범위 밖의 화면입니다."
    />
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg.default },
  appBar: {
    minHeight: 56,
    paddingHorizontal: theme.layout.horizontalGutter,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.default,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appBarTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.text.primary,
    flex: 1,
  },
  button: {
    minHeight: theme.layout.buttonMinHeight,
    borderRadius: theme.radius[12],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space[16],
  },
  buttonSecondary: {
    backgroundColor: theme.colors.surface.default,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
  },
  buttonTextVariant: { backgroundColor: 'transparent' },
  buttonLabel: { ...theme.typography.button, color: theme.colors.text.onPrimary },
  fieldLabel: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  input: {
    minHeight: theme.layout.inputMinHeight,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[16],
    ...theme.typography.body,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.surface.default,
  },
  errorText: { ...theme.typography.caption, color: theme.colors.status.error },
  card: {
    flexDirection: 'row',
    gap: theme.space[12],
    padding: theme.space[16],
    borderRadius: theme.radius[16],
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.default,
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...theme.typography.cardTitle, color: theme.colors.primary.default },
  cardTitle: { ...theme.typography.cardTitle, color: theme.colors.text.primary },
  cardSub: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[12],
    padding: theme.space[20],
  },
});
