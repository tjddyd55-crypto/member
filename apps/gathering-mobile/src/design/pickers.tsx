import { createElement, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import {
  POSTCODE_PAGE,
  composeAddress,
  dateFromDateInput,
  dateInputValue,
  formatKoreanDate,
  formatKoreanTime,
  parsePostcodeMessage,
  timeFromTimeInput,
  timeInputValue,
} from '../features/forms/values';
import { Button, TextField } from './ui';

export function DateTimeField({
  label,
  mode,
  value,
  onChange,
}: {
  label: string;
  mode: 'date' | 'time';
  value: Date;
  onChange: (next: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const shown = mode === 'date' ? formatKoreanDate(value) : formatKoreanTime(value);
  const change = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (selected) onChange(selected);
  };
  const webValue = mode === 'date' ? dateInputValue(value) : timeInputValue(value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'web' ? (
        createElement('input', {
          type: mode === 'date' ? 'date' : 'time',
          value: webValue,
          'aria-label': label,
          onChange: (event: { target: { value: string } }) => {
            const next =
              mode === 'date' ? dateFromDateInput(event.target.value, value) : timeFromTimeInput(event.target.value, value);
            if (next) onChange(next);
          },
          style: webInputStyle,
        })
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.input}>
          <Text style={styles.value}>{shown}</Text>
        </Pressable>
      )}
      {open && Platform.OS === 'android' ? (
        <DateTimePicker locale="ko-KR" value={value} mode={mode} display="default" onChange={change} />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.sheetBackdrop}>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" style={styles.sheetDismiss} onPress={() => setOpen(false)} />
            <View style={[styles.sheet, { paddingBottom: theme.space[16] + insets.bottom }]}>
              <DateTimePicker value={value} mode={mode} display="spinner" locale="ko-KR" onChange={change} />
              <Button label="완료" variant="secondary" onPress={() => setOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export function AddressField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [road, setRoad] = useState(value);
  const [detail, setDetail] = useState('');
  const [open, setOpen] = useState(false);
  const composed = composeAddress(road, detail);

  useEffect(() => {
    if (value !== composed) {
      setRoad(value);
      setDetail('');
    }
  }, [composed, value]);

  const apply = (nextRoad: string, nextDetail: string) => {
    setRoad(nextRoad);
    setDetail(nextDetail);
    onChange(composeAddress(nextRoad, nextDetail));
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.input}>
        <Text style={styles.value}>{road.trim() ? road : '주소 검색'}</Text>
      </Pressable>
      <TextField
        label="상세 주소 (선택)"
        value={detail}
        onChangeText={(next) => apply(road, next)}
        placeholder="동, 호수"
      />
      <Modal animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <Button label="닫기" variant="text" onPress={() => setOpen(false)} />
          {Platform.OS === 'web' ? (
            <WebPostcode
              onSelect={(roadAddress) => {
                apply(roadAddress, detail);
                setOpen(false);
              }}
            />
          ) : (
            <WebView
              source={{ html: POSTCODE_PAGE }}
              onMessage={(event) => {
                const roadAddress = parsePostcodeMessage(event.nativeEvent.data);
                if (!roadAddress) return;
                apply(roadAddress, detail);
                setOpen(false);
              }}
              originWhitelist={['*']}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

function WebPostcode({ onSelect }: { onSelect: (road: string) => void }) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      const roadAddress = parsePostcodeMessage(raw);
      if (!roadAddress) return;
      onSelect(roadAddress);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);
  return createElement('iframe', {
    title: '주소 검색',
    srcDoc: POSTCODE_PAGE,
    style: { border: '0', width: '100%', height: '100%', flex: 1 },
  });
}

const styles = StyleSheet.create({
  field: { gap: theme.space[8] },
  label: { ...theme.typography.bodySmall, color: theme.colors.text.primary, fontWeight: '500' },
  input: {
    minHeight: theme.layout.inputMinHeight,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[16],
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.default,
  },
  value: { ...theme.typography.body, color: theme.colors.text.primary },
  modal: { flex: 1, backgroundColor: theme.colors.bg.default, paddingTop: theme.space[16] },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    gap: theme.space[12],
    padding: theme.space[16],
    backgroundColor: theme.colors.bg.default,
    borderTopLeftRadius: theme.radius[12],
    borderTopRightRadius: theme.radius[12],
  },
});

const webInputStyle = {
  minHeight: theme.layout.inputMinHeight,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: theme.colors.border.default,
  borderRadius: theme.radius[12],
  paddingLeft: theme.space[16],
  paddingRight: theme.space[16],
  fontSize: 16,
  color: theme.colors.text.primary,
  backgroundColor: theme.colors.bg.default,
};
