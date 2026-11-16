import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { dataVersion, subscribeInvalidation, type DataKind } from './invalidation';

// One focus effect handles mount, focus return, active tab changes and invalidation.
// A short debounce merges upload batches and explicit post-mutation refreshes.
export function useInvalidatedRefresh(
  groupId: string,
  kind: DataKind | 'all',
  load: () => Promise<unknown> | void,
  active = true,
) {
  const version = useSyncExternalStore(subscribeInvalidation, () =>
    kind === 'all'
      ? `${dataVersion(groupId, 'media')}:${dataVersion(groupId, 'finance')}:${dataVersion(groupId, 'schedule')}`
      : dataVersion(groupId, kind),
  );
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      const timer = setTimeout(() => {
        void load();
      }, 80);
      return () => clearTimeout(timer);
    }, [active, load, version]),
  );
}

// Serialize refreshes, merging overlapping calls into one trailing request. A change
// arriving during a read must get a fresh read after that read finishes.
export function useRefreshLoad<T extends unknown[]>(task: (...args: T) => Promise<void>) {
  const pending = useRef<{ args: T; waiters: Array<() => void> } | null>(null);
  const running = useRef(false);
  const latest = useRef(task);
  latest.current = task;
  return useCallback(
    (...args: T): Promise<void> =>
      new Promise((resolve) => {
        if (pending.current) {
          // A background refresh must not replace an explicit year selection.
          if (args.length > 0) pending.current.args = args;
          pending.current.waiters.push(resolve);
        } else pending.current = { args, waiters: [resolve] };
        if (running.current) return;
        running.current = true;
        void (async () => {
          try {
            while (pending.current) {
              // Merge same-tick success signals and explicit refresh calls.
              await new Promise((done) => setTimeout(done, 100));
              const next = pending.current;
              pending.current = null;
              try {
                await latest.current(...next.args);
              } finally {
                next.waiters.forEach((done) => done());
              }
            }
          } finally {
            running.current = false;
          }
        })();
      }),
    [task],
  );
}
