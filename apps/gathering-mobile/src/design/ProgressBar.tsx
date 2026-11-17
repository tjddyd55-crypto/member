import { StyleSheet, View } from 'react-native';
import { theme } from '../theme';

export function ProgressBar({ percent }: { percent: number }) {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${value}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: theme.colors.bg.subtle,
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: theme.colors.primary.default },
});
