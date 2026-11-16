import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

// The tile owns the hit target and accessibility state; this overlay never intercepts touches.
export function SelectCheckbox({ selected }: { selected: boolean }) {
  return (
    <View pointerEvents="none" accessible={false} style={styles.outline}>
      <View style={[styles.box, selected && styles.selected]}>
        {selected ? (
          <Ionicons name="checkmark" size={20} color={theme.colors.text.primary} />
        ) : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  outline: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.25)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.9,
    shadowRadius: 2,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.6)',
  },
  box: {
    flex: 1,
    margin: -1,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#FFFFFF' },
});
