import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GatheringEventView } from '@member/contracts';
import { theme } from '../../theme';
import { eventDateBlock } from './range';

export function EventScheduleRow({
  event,
  past = false,
  showGroupName = false,
}: {
  event: GatheringEventView;
  past?: boolean;
  showGroupName?: boolean;
}) {
  const block = eventDateBlock(event.startsAt);
  const pastStyle = past && styles.past;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/(app)/groups/${event.groupId}/events/${event.id}`)}
      style={styles.row}
    >
      <View style={styles.dateBlock}>
        {block.year ? <Text style={[styles.date, pastStyle]}>{block.year}</Text> : null}
        <Text style={[styles.bigDate, pastStyle]}>
          {block.date}<Text style={styles.weekday}> {block.weekday}</Text>
        </Text>
        <Text style={[styles.time, pastStyle]}>{block.time}</Text>
      </View>
      <View style={styles.details}>
        {showGroupName ? <Text style={[styles.groupName, pastStyle]}>{event.groupName}</Text> : null}
        <Text style={[styles.title, pastStyle]}>{event.title}</Text>
        {event.status === 'CANCELLED' ? <Text style={styles.date}>취소</Text> : null}
        {event.place ? (
          <Text numberOfLines={1} style={[styles.place, pastStyle]}>
            {event.place}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  details: { flex: 1, minWidth: 0, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[16],
    paddingVertical: theme.space[16],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.default,
  },
  dateBlock: { width: 96, flexShrink: 0 },
  bigDate: { fontSize: 24, lineHeight: 30, fontWeight: '700', fontVariant: ['tabular-nums'], color: theme.colors.text.primary },
  weekday: { fontSize: 13, fontWeight: '500' },
  time: { fontSize: 15, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'], color: theme.colors.text.secondary, marginTop: 4 },
  past: { color: theme.colors.text.disabled },
  groupName: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: theme.colors.text.primary },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '500', color: theme.colors.text.primary },
  place: { fontSize: 14, lineHeight: 20, color: theme.colors.text.secondary },
  date: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
