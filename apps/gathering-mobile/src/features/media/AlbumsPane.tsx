import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { GatheringAlbumEvent, GatheringAlbumYear } from '@member/contracts';
import { api } from '../../api/client';
import { Body, EmptyState, ErrorState } from '../../design/ui';
import { theme } from '../../theme';

export function AlbumsPane({ groupId }: { groupId: string }) {
  const [years, setYears] = useState<GatheringAlbumYear[]>([]);
  const [events, setEvents] = useState<GatheringAlbumEvent[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await api.albums(groupId, year ?? undefined);
      setYears(result.years);
      setEvents(result.events);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '앨범을 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [groupId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'error') return <ErrorState message={message} onRetry={() => void load()} />;
  return (
    <View style={styles.stack}>
      <View style={styles.years}>
        <YearChip label="전체" selected={year == null} onPress={() => setYear(null)} />
        {years.map((item) => (
          <YearChip
            key={item.year}
            label={`${item.year}`}
            selected={year === item.year}
            onPress={() => setYear(item.year)}
          />
        ))}
      </View>
      {status === 'ready' && events.length === 0 ? (
        <EmptyState title="앨범이 비어 있습니다" description="행사에 사진이나 영상을 올리면 여기에 모입니다." />
      ) : null}
      {events.map((event) => (
        <Pressable
          key={event.eventId}
          accessibilityRole="button"
          onPress={() => router.push(`/(app)/groups/${groupId}/events/${event.eventId}?tab=media`)}
          style={styles.card}
        >
          <Text style={styles.title}>{event.title}</Text>
          <Body>
            사진 {event.photoCount} · 영상 {event.videoCount}
          </Body>
        </Pressable>
      ))}
    </View>
  );
}

function YearChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={{ color: selected ? theme.colors.text.onPrimary : theme.colors.text.primary }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: theme.space[12] },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[8] },
  chip: {
    minHeight: 36,
    borderRadius: theme.radius[12],
    paddingHorizontal: theme.space[12],
    justifyContent: 'center',
    backgroundColor: theme.colors.bg.subtle,
  },
  chipOn: { backgroundColor: theme.colors.primary.default },
  card: { gap: theme.space[8], paddingVertical: theme.space[8] },
  title: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
});