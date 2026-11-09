import { useSyncExternalStore } from 'react';
import { todayId } from '@/lib/dates';
import { createLogNavigation } from '@/lib/log-navigation';
import { beginLogNavigation, installLogPerformance } from '@/dev/log-performance';

export const logsDateStore = createLogNavigation(todayId(), __DEV__ ? beginLogNavigation : undefined);

if (__DEV__) installLogPerformance(logsDateStore);

export function useLogsSelectedDate(): [string, (dateId: string) => void] {
  const dateId = useSyncExternalStore(
    logsDateStore.subscribe,
    logsDateStore.get,
    logsDateStore.get
  );
  return [dateId, logsDateStore.set];
}

// Revision is external reactive state too. An imperative read during render
// can be memoized forever by the production React Compiler.
export function useLogsDateRevision(): number {
  return useSyncExternalStore(
    logsDateStore.subscribe,
    logsDateStore.getRevision,
    logsDateStore.getRevision
  );
}
