import { useCallback, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { router } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { api } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../design/ui';
import { theme } from '../../theme';
import { useInvalidatedRefresh, useRefreshLoad } from '../../state/useInvalidatedRefresh';
import { formatEventDateTime } from './range';

type Direction = 'upcoming' | 'past';
type Page = { items: GatheringEventView[]; nextCursor: string | null };
const emptyPage = (): Page => ({ items: [], nextCursor: null });

// Both schedule screens use one virtualized scroll, never a list inside a ScrollView.
export function EventsTimeline({ groupId }: { groupId?: string }) {
  const [pages, setPages] = useState({ upcoming: emptyPage(), past: emptyPage() });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [paging, setPaging] = useState(false);
  const generation = useRef(0);
  const refreshing = useRef(false);
  const requests = useRef(new Set<Direction>());

  const read = useCallback(async () => {
    const current = ++generation.current;
    refreshing.current = true;
    setMessage('');
    setStatus('loading');
    try {
      const [upcoming, past] = await Promise.all([
        api.eventsTimeline(groupId, 'upcoming'),
        api.eventsTimeline(groupId, 'past'),
      ]);
      if (current !== generation.current) return;
      setPages({ upcoming, past });
      setStatus('ready');
    } catch (error) {
      if (current !== generation.current) return;
      setMessage(error instanceof Error ? error.message : '일정을 불러오지 못했습니다.');
      setStatus('error');
    } finally {
      if (current === generation.current) refreshing.current = false;
    }
  }, [groupId]);
  const load = useRefreshLoad(read);
  useInvalidatedRefresh(groupId ?? '*', 'schedule', load);

  const loadMore = async (direction: Direction) => {
    const cursor = pages[direction].nextCursor;
    if (!cursor || status !== 'ready' || refreshing.current || requests.current.size || message)
      return;
    const current = generation.current;
    requests.current.add(direction);
    setPaging(true);
    try {
      const page = await api.eventsTimeline(groupId, direction, cursor);
      if (current !== generation.current) return;
      setPages((previous) => {
        const seen = new Set(previous[direction].items.map((item) => item.id));
        return {
          ...previous,
          [direction]: {
            ...page,
            items: [
              ...previous[direction].items,
              ...page.items.filter((item) => !seen.has(item.id)),
            ],
          },
        };
      });
    } catch (error) {
      if (current === generation.current)
        setMessage(error instanceof Error ? error.message : '일정을 더 불러오지 못했습니다.');
    } finally {
      requests.current.delete(direction);
      setPaging(false);
    }
  };
  // Keep RN's viewability handler stable while using the latest cursor/refresh guards.
  const moreRef = useRef(loadMore);
  moreRef.current = loadMore;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    for (const token of viewableItems) {
      const direction: Direction | undefined = token.section?.key;
      if (
        direction &&
        token.index != null &&
        token.index >= pagesRef.current[direction].items.length - 5
      )
        void moreRef.current(direction);
    }
  }).current;

  return (
    <SectionList
      style={styles.list}
      contentContainerStyle={styles.content}
      sections={[
        { key: 'upcoming', title: '예정', data: pages.upcoming.items },
        { key: 'past', title: '지난 일정', data: pages.past.items },
      ]}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      refreshing={status === 'loading'}
      onRefresh={() => void load()}
      onEndReached={() => void loadMore(pages.upcoming.nextCursor ? 'upcoming' : 'past')}
      onEndReachedThreshold={0.5}
      onViewableItemsChanged={onViewableItemsChanged}
      ListHeaderComponent={
        <View>
          {status === 'loading' && !pages.upcoming.items.length && !pages.past.items.length ? (
            <LoadingState />
          ) : null}
          {message ? <ErrorState message={message} onRetry={() => void load()} /> : null}
          {status === 'ready' && !pages.upcoming.items.length && !pages.past.items.length ? (
            <EmptyState title="등록된 일정이 없습니다" />
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.data.length ? <Text style={styles.section}>{section.title}</Text> : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/(app)/groups/${item.groupId}/events/${item.id}`)}
          style={styles.row}
        >
          <Text style={styles.date}>
            {formatEventDateTime(item.startsAt)}
            {item.status === 'CANCELLED' ? ' · 취소' : ''}
          </Text>
          <Text style={styles.title}>{item.title}</Text>
          {!groupId ? <Text style={styles.date}>{item.groupName}</Text> : null}
          {item.place ? <Text style={styles.date}>{item.place}</Text> : null}
        </Pressable>
      )}
      ListFooterComponent={paging ? <LoadingState /> : null}
    />
  );
}
const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: 120 },
  section: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    paddingTop: theme.space[16],
    paddingBottom: theme.space[8],
  },
  row: { gap: theme.space[4], paddingVertical: theme.space[8] },
  title: { ...theme.typography.body, color: theme.colors.text.primary },
  date: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
