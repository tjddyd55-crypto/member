import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import {
  POSTCODE_PAGE,
  composeAddress,
  formatKoreanDate,
  formatKoreanTime,
  parsePostcodeMessage,
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
  const shown = mode === 'date' ? formatKoreanDate(value) : formatKoreanTime(value);
  const change = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (selected) onChange(selected);
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.input}>
        <Text style={styles.value}>{shown}</Text>
      </Pressable>
      {open && Platform.OS === 'android' ? (
        <DateTimePicker locale="ko-KR" value={value} mode={mode} display="default" onChange={change} />
      ) : null}
      {open && Platform.OS === 'ios' ? (
        <View>
          <DateTimePicker value={value} mode={mode} display="spinner" locale="ko-KR" onChange={change} />
          <Button label="완료" variant="secondary" onPress={() => setOpen(false)} />
        </View>
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
        </View>
      </Modal>
    </View>
  );
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
});
