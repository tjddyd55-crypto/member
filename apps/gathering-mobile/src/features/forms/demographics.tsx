import { createElement, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatheringSex } from '@member/gathering-domain';
import { Button } from '../../design/ui';
import { theme } from '../../theme';
import { dateFromDateInput, dateInputValue, formatKoreanDate } from './values';

export const SEX_DISCLAIMER = '남/여만 저장합니다. 주민등록번호는 받지 않습니다.';

export function BirthDateField({
  label = '생년월일',
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selected = value ? dateFromDateInput(value, new Date()) : null;
  const shown = selected ? formatKoreanDate(selected) : '생년월일을 선택하세요';
  const change = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (next) onChange(dateInputValue(next));
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text.primary, fontWeight: '500' }}>{label}</Text>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: 'date',
          value,
          'aria-label': label,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          style: {
            fontSize: 16,
            lineHeight: '22px',
            padding: '12px 12px',
            borderRadius: 8,
            border: `1px solid ${theme.colors.border.default}`,
            color: theme.colors.text.primary,
            background: theme.colors.bg.default,
          },
        })
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        }}>
          <Text style={{ fontSize: 16, lineHeight: 22, color: value ? theme.colors.text.primary : theme.colors.text.secondary }}>
            {shown}
          </Text>
        </Pressable>
      )}
      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          locale="ko-KR"
          value={selected ?? new Date(1990, 0, 15)}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={change}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.35)' }}>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" style={{ flex: 1 }} onPress={() => setOpen(false)} />
            <View style={{
              backgroundColor: theme.colors.bg.default,
              paddingTop: theme.space[12],
              paddingBottom: theme.space[16] + insets.bottom,
              paddingLeft: theme.layout.horizontalGutter + insets.left,
              paddingRight: theme.layout.horizontalGutter + insets.right,
            }}>
              <DateTimePicker
                value={selected ?? new Date(1990, 0, 15)}
                mode="date"
                display="spinner"
                locale="ko-KR"
                maximumDate={new Date()}
                onChange={change}
              />
              <Button label="완료" variant="secondary" onPress={() => setOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function SexField({
  label = '성별',
  value,
  onChange,
}: {
  label?: string;
  value: GatheringSex | '';
  onChange: (next: GatheringSex) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text.primary, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: theme.space[8] }}>
        {([
          ['MALE', '남'],
          ['FEMALE', '여'],
        ] as const).map(([sex, text]) => (
          <View key={sex} style={{ flex: 1 }}>
            <Button label={text} variant={value === sex ? 'primary' : 'secondary'} onPress={() => onChange(sex)} />
          </View>
        ))}
      </View>
      <Text style={{ ...theme.typography.bodySmall, color: theme.colors.text.secondary }}>{SEX_DISCLAIMER}</Text>
    </View>
  );
}
