import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GatheringFinanceSummary } from '@member/contracts';
import { theme } from '../../theme';
import { fiscalRange, fiscalYearLabel } from './fiscal-year';

export function FiscalYearTabs({
  years,
  selectedYear,
  onSelect,
}: {
  years: GatheringFinanceSummary['years'];
  selectedYear: number;
  onSelect: (year: number) => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<number, number>>({});
  const reveal = useCallback(() => {
    const x = positions.current[selectedYear];
    if (x !== undefined)
      scroll.current?.scrollTo({
        x: Math.max(0, x - theme.layout.horizontalGutter),
        animated: true,
      });
  }, [selectedYear]);
  useEffect(reveal, [reveal, years]);
  const selected = years.find((item) => item.year === selectedYear);
  const now = new Date();
  return (
    <View style={styles.stack}>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onLayout={reveal}
        onContentSizeChange={reveal}
      >
        {[...years]
          .sort((a, b) => a.year - b.year)
          .map((item) => {
            const active = item.year === selectedYear;
            const label = fiscalYearLabel(item.year, years, now);
            return (
              <Pressable
                key={item.year}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(item.year)}
                onLayout={(event) => {
                  positions.current[item.year] = event.nativeEvent.layout.x;
                  reveal();
                }}
                style={[styles.chip, active && styles.active]}
              >
                <Text style={[styles.year, active && styles.activeText]}>{item.year}</Text>
                {label ? (
                  <Text style={[styles.small, active && styles.activeText]}>{label}</Text>
                ) : null}
                {item.status === 'CLOSED' ? (
                  <Text style={[styles.small, active && styles.activeText]}>마감</Text>
                ) : null}
              </Pressable>
            );
          })}
      </ScrollView>
      {selected ? (
        <Text style={styles.small}>
          {fiscalRange(selected.startsAt, selected.endsAt)} ·{' '}
          {selected.status === 'CLOSED' ? '마감' : '진행 중'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[8] },
  row: { gap: theme.space[8] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
    minHeight: 44,
    paddingHorizontal: theme.space[12],
    paddingVertical: theme.space[8],
    borderRadius: theme.radius[12],
    backgroundColor: theme.colors.bg.subtle,
  },
  active: { backgroundColor: theme.colors.text.primary },
  year: { ...theme.typography.body, fontWeight: '700', color: theme.colors.text.primary },
  small: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
  activeText: { color: theme.colors.bg.default },
});
