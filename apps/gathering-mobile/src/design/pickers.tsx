import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, type TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import {
  POSTCODE_BASE_URL,
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
            <View style={[styles.sheet, { paddingBottom: theme.space[16] + insets.bottom, paddingLeft: theme.layout.horizontalGutter + insets.left, paddingRight: theme.layout.horizontalGutter + insets.right }]}>
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
  const detailRef = useRef<TextInput>(null);
  const pendingFocus = useRef(false);

  const focusDetail = useCallback(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    detailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open || !pendingFocus.current || Platform.OS === 'ios') return;
    // Android has no Modal onDismiss callback, so wait for its slide transition.
    const timer = setTimeout(focusDetail, Platform.OS === 'android' ? 350 : 50);
    return () => clearTimeout(timer);
  }, [open, focusDetail]);


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

  const selectAddress = (address: string) => {
    apply(address, detail);
    pendingFocus.current = true;
    setOpen(false);
  };


  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          pendingFocus.current = false;
          setOpen(true);
        }}
        style={styles.input}
      >
        <Text style={styles.value}>{road.trim() ? road : '주소 검색'}</Text>
      </Pressable>
      <TextField
        ref={detailRef}
        label="상세 주소 (선택)"
        value={detail}
        onChangeText={(next) => apply(road, next)}
        placeholder="동, 호수"
      />
      <Modal
        animationType="slide"
        visible={open}
        onDismiss={focusDetail}
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.modal}>
          <Button label="닫기" variant="text" onPress={() => setOpen(false)} />
          {Platform.OS === 'web' ? (
            <WebPostcode onSelect={selectAddress} />
          ) : (
            <WebView
              source={{ html: POSTCODE_PAGE, baseUrl: POSTCODE_BASE_URL }}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={({ url, isTopFrame, navigationType }) => {
                if (url === 'about:blank') return true;
                try {
                  const { origin, protocol } = new URL(url);
                  if (origin === POSTCODE_BASE_URL || origin === 'https://t1.kakaocdn.net') return true;
                  if (
                    (isTopFrame || navigationType === 'click') &&
                    (protocol === 'http:' || protocol === 'https:')
                  ) {
                    void Linking.openURL(url).catch(() => undefined);
                  }
                } catch {
                  return false;
                }
                return false;
              }}
              onMessage={(event) => {
                const address = parsePostcodeMessage(event.nativeEvent.data);
                if (address) selectAddress(address);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

type PostcodeConstructor = new (options: {
  oncomplete: (data: { zonecode: string; roadAddress: string; jibunAddress: string }) => void;
  banner: boolean;
  useBannerLink: boolean;
  width: string;
  height: string;
}) => { embed: (container: HTMLDivElement) => void };

function WebPostcode({ onSelect }: { onSelect: (road: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const browser = window as Window & {
      kakao?: { Postcode?: PostcodeConstructor };
      daum?: { Postcode?: PostcodeConstructor };
    };
    const getPostcode = () => browser.kakao?.Postcode ?? browser.daum?.Postcode;
    let active = true;
    const embed = () => {
      const Postcode = getPostcode();
      if (!active || containerRef.current !== container || !Postcode) return;

      new Postcode({
        oncomplete: ({ zonecode, roadAddress, jibunAddress }) => {
          if (!active || containerRef.current !== container) return;
          const address = parsePostcodeMessage(JSON.stringify({ zonecode, roadAddress, jibunAddress }));
          if (address) onSelectRef.current(address);
        },
        banner: false,
        useBannerLink: false,
        width: '100%',
        height: '100%',
      }).embed(container);
    };

    let script: HTMLScriptElement | undefined;
    if (getPostcode()) {
      embed();
    } else {
      script = document.createElement('script');
      script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.async = true;
      script.addEventListener('load', embed);
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      script?.removeEventListener('load', embed);
      script?.remove();
      container.replaceChildren();
    };
  }, []);

  return createElement('div', {
    role: 'region',
    'aria-label': '주소 검색',
    ref: containerRef,
    style: { width: '100%', height: '100%', flex: 1, minHeight: 0 },
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
    paddingHorizontal: theme.layout.horizontalGutter,
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.default,
  },
  value: { ...theme.typography.body, color: theme.colors.text.primary },
  modal: { flex: 1, backgroundColor: theme.colors.bg.default, padding: theme.layout.horizontalGutter },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetDismiss: { flex: 1 },
  sheet: {
    gap: theme.space[12],
    padding: theme.layout.horizontalGutter,
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
  paddingLeft: theme.layout.horizontalGutter,
  paddingRight: theme.layout.horizontalGutter,
  fontSize: 16,
  color: theme.colors.text.primary,
  backgroundColor: theme.colors.bg.default,
};
