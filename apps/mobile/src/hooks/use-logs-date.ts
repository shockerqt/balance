import { useSyncExternalStore } from 'react';
import { todayId } from '@/lib/dates';

let currentDateId = todayId();
const listeners = new Set<() => void>();

export const logsDateStore = {
  get: () => currentDateId,
  set: (next: string) => {
    if (currentDateId === next) return;
    currentDateId = next;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useLogsSelectedDate(): [string, (dateId: string) => void] {
  const dateId = useSyncExternalStore(
    logsDateStore.subscribe,
    logsDateStore.get,
    logsDateStore.get
  );
  return [dateId, logsDateStore.set];
}
