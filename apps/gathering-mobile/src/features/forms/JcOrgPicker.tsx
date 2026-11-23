import { useEffect, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GatheringAffiliationView, JcDistrictRef, JcOrgChoice } from '@member/contracts';
import { normalizeJcName } from '@member/gathering-domain';
import { api } from '../../api/client';
import { Button, EmptyState, ErrorState, LoadingState, TextField, Title } from '../../design/ui';
import { theme } from '../../theme';
import { keyboardAvoidingBehavior } from './values';

export type JcPickerValue = { district: JcDistrictRef | null; local: JcDistrictRef | null };

export function jcPickerValue(affiliation?: GatheringAffiliationView | null): JcPickerValue {
  if (!affiliation?.localId || !affiliation.district || affiliation.affiliationNeedsReselect) {
    return { district: null, local: null };
  }
  return {
    district: affiliation.district,
    local: { id: affiliation.localId, displayName: affiliation.localDisplayName },
  };
}

export function JcOrgPicker({
  value,
  onChange,
}: {
  value: JcPickerValue;
  onChange: (value: JcPickerValue) => void;
}) {
  const [open, setOpen] = useState<'district' | 'local' | null>(null);
  const close = () => {
    Keyboard.dismiss();
    setOpen(null);
  };
  return (
    <View style={styles.fields}>
      <PickerField
        label="소속 지구"
        value={value.district?.displayName}
        onPress={() => setOpen('district')}
      />
      <PickerField
        label="소속 로컬"
        value={value.local?.displayName}
        disabled={!value.district}
        onPress={() => setOpen('local')}
      />
      <Modal visible={open !== null} animationType="slide" onRequestClose={close}>
        {open ? (
          <ChoiceList
            key={open}
            label={open === 'district' ? '소속 지구' : '소속 로컬'}
            districtId={open === 'local' ? value.district?.id : undefined}
            selectedId={value[open]?.id}
            onClose={close}
            onSelect={(choice) => {
              if (open === 'local') onChange({ ...value, local: choice });
              else if (choice.id !== value.district?.id)
                onChange({ district: choice, local: null });
              close();
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function PickerField({
  label,
  value,
  disabled,
  onPress,
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const placeholder = disabled ? '지구를 먼저 선택하세요' : '선택해 주세요';
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.field}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? placeholder}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          onPress();
        }}
      >
        <Text style={[styles.name, !value && styles.placeholder]}>{value ?? placeholder}</Text>
        <Text style={styles.placeholder}>⌄</Text>
      </Pressable>
    </View>
  );
}

function ChoiceList({
  label,
  districtId,
  selectedId,
  onClose,
  onSelect,
}: {
  label: string;
  districtId?: string;
  selectedId?: string;
  onClose: () => void;
  onSelect: (org: JcOrgChoice) => void;
}) {
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ items: JcOrgChoice[] } | { error: string } | null>(null);
  const serverQuery = districtId ? query.trim() : '';

  useEffect(() => {
    let current = true;
    setResult(null);
    const timer = setTimeout(
      () => {
        const fetchItems = districtId ? api.jcLocals(districtId, serverQuery) : api.jcDistricts();
        void fetchItems.then(
          (data) => {
            if (current) setResult(data);
          },
          () => {
            if (current) setResult({ error: '조직 목록을 불러오지 못했습니다.' });
          },
        );
      },
      serverQuery ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [attempt, districtId, serverQuery]);

  const normalized = normalizeJcName(query, 'DISTRICT');
  const items =
    result && 'items' in result
      ? result.items.filter(
          (org) =>
            districtId ||
            !normalized ||
            [org.name, org.displayName].some((name) =>
              normalizeJcName(name, 'DISTRICT').includes(normalized),
            ),
        )
      : [];

  return (
    <SafeAreaView style={styles.modal}>
      <KeyboardAvoidingView style={styles.content} behavior={keyboardAvoidingBehavior(Platform.OS)}>
        <View style={styles.header}>
          <Title>{label} 선택</Title>
          <Button label="닫기" variant="text" onPress={onClose} />
        </View>
        <TextField
          label={`${label} 검색`}
          value={query}
          maxLength={120}
          onChangeText={setQuery}
          placeholder="이름으로 검색"
        />
        {!result ? (
          <LoadingState />
        ) : 'error' in result ? (
          <ErrorState message={result.error} onRetry={() => setAttempt((count) => count + 1)} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(org) => org.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<EmptyState title="검색 결과가 없습니다" />}
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.field, selected && styles.selected]}
                  onPress={() => onSelect(item)}
                >
                  <Text style={styles.name}>{item.displayName}</Text>
                  {selected ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fields: { gap: theme.space[8] },
  label: { ...theme.typography.bodySmall, color: theme.colors.text.primary, marginBottom: 4 },
  field: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    padding: theme.space[12],
    marginBottom: 4,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.default,
  },
  name: { flex: 1, fontSize: 16, color: theme.colors.text.primary },
  placeholder: { color: theme.colors.text.secondary },
  modal: { flex: 1, backgroundColor: theme.colors.bg.default },
  content: { flex: 1, paddingHorizontal: theme.layout.horizontalGutter, gap: theme.space[8] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selected: { backgroundColor: theme.colors.bg.subtle, borderColor: theme.colors.accent },
  check: { fontSize: 18, color: theme.colors.accent },
});
