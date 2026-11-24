import { useCallback, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { router } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import { api } from '../../api/client';
import { EmptyState, ErrorState, LoadingState } from '../../design/ui';
import { theme } from '../../theme';
import { useInvalidatedRefresh, useRefreshLoad } from '../../state/useInvalidatedRefresh';
import { eventDateBlock } from './range';

import {
  TimelinePageQueue,
  timelineEndDirection,
  type TimelineDirection as Direction,
} from './timeline-paging';
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
  const pagesRef = useRef(pages);
  const pageQueue = useRef(new TimelinePageQueue()).current;
  const fetchMoreRef = useRef<(direction: Direction) => Promise<void>>(async () => undefined);

  const read = useCallback(async () => {
    const current = ++generation.current;
    refreshing.current = true;
    pageQueue.clear();
    setMessage('');
    setStatus('loading');
    try {
      const [upcoming, past] = await Promise.all([
        api.eventsTimeline(groupId, 'upcoming'),
        api.eventsTimeline(groupId, 'past'),
      ]);
      if (current !== generation.current) return;
      pagesRef.current = { upcoming, past };
      setPages(pagesRef.current);
      setStatus('ready');
    } catch (error) {
      if (current !== generation.current) return;
      setMessage(error instanceof Error ? error.message : '일정을 불러오지 못했습니다.');
      setStatus('error');
    } finally {
      if (current === generation.current) refreshing.current = false;
    }
  }, [groupId, pageQueue]);
  const load = useRefreshLoad(read);
  useInvalidatedRefresh(groupId ?? '*', 'schedule', load);

  const fetchMore = async (direction: Direction) => {
    const current = generation.current;
    try {
      const cursor = pagesRef.current[direction].nextCursor;
      if (!cursor || status !== 'ready' || refreshing.current) return;
      setPaging(true);
      const page = await api.eventsTimeline(groupId, direction, cursor);
      if (current !== generation.current) return;
      const previous = pagesRef.current;
      const seen = new Set(previous[direction].items.map((item) => item.id));
      const nextPages = {
        ...previous,
        [direction]: {
          ...page,
          items: [...previous[direction].items, ...page.items.filter((item) => !seen.has(item.id))],
        },
      };
      // Publish cursors before draining queued demand, without waiting for React's next render.
      pagesRef.current = nextPages;
      setPages(nextPages);
    } catch (error) {
      if (current === generation.current)
        setMessage(error instanceof Error ? error.message : '일정을 더 불러오지 못했습니다.');
    } finally {
      setPaging(false);
      const next = pageQueue.complete();
      if (next) void fetchMoreRef.current(next);
    }
  };
  fetchMoreRef.current = fetchMore;
  const loadMore = (direction: Direction) => {
    const next = pageQueue.request(direction);
    if (next) void fetchMoreRef.current(next);
  };
  // Keep RN's viewability handler stable while using the latest cursor/refresh guards.
  const moreRef = useRef(loadMore);
  moreRef.current = loadMore;
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
        { key: 'upcoming', data: pages.upcoming.items },
        { key: 'past', data: pages.past.items },
      ]}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      refreshing={status === 'loading'}
      onRefresh={() => void load()}
      onEndReached={() => loadMore(timelineEndDirection(pages.past.items.length))}
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
        section.key === 'past' && section.data.length ? (
          <Text style={styles.section}>지난 일정</Text>
        ) : null
      }
      renderItem={({ item, section }) => {
        const block = eventDateBlock(item.startsAt);
        const past = section.key === 'past';
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/(app)/groups/${item.groupId}/events/${item.id}`)}
            style={styles.row}
          >
            <View style={styles.dateBlock}>
              {block.year ? <Text style={styles.date}>{block.year}</Text> : null}
              <Text style={[styles.bigDate, past && styles.past]}>
                {block.date}<Text style={styles.weekday}> {block.weekday}</Text>
              </Text>
              <Text style={[styles.date, past && styles.past]}>{block.time}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              {!groupId ? <Text style={[styles.groupName, past && styles.past]}>{item.groupName}</Text> : null}
              <Text style={[styles.title, past && styles.past]}>{item.title}</Text>
              {item.status === 'CANCELLED' ? <Text style={styles.date}>취소</Text> : null}
              {item.place ? (
                <Text numberOfLines={1} style={[styles.date, past && styles.past]}>
                  {item.place}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListFooterComponent={paging ? <LoadingState /> : null}
    />
  );
}
const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: 120 },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.default,
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    paddingTop: theme.space[16],
    paddingBottom: theme.space[8],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[16],
    paddingVertical: theme.space[12],
  },
  dateBlock: { width: 112 },
  bigDate: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: theme.colors.text.primary },
  weekday: { fontSize: 16, fontWeight: '600' },
  past: { color: theme.colors.text.disabled },
  groupName: { ...theme.typography.body, fontWeight: '700', color: theme.colors.text.primary },
  title: { ...theme.typography.body, color: theme.colors.text.primary },
  date: { ...theme.typography.bodySmall, color: theme.colors.text.secondary },
});
