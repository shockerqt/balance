import { useSyncExternalStore } from 'react';
import { todayId } from '@/lib/dates';
import { createLogNavigation } from '@/lib/log-navigation';

export const logsDateStore = createLogNavigation(todayId());

export function useLogsSelectedDate(): [string, (dateId: string) => void] {
  const dateId = useSyncExternalStore(
    logsDateStore.subscribe,
    logsDateStore.get,
    logsDateStore.get
  );
  return [dateId, logsDateStore.set];
}
