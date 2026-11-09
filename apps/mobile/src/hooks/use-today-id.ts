import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { todayId } from '@/lib/dates';

/** Refresh presentation across Chilean midnight and a background/foreground cycle. */
export function useTodayId() {
  const [today, setToday] = useState(todayId);
  useEffect(() => {
    const refresh = () => setToday(todayId());
    refresh();
    const subscription = AppState.addEventListener('change', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, []);
  return today;
}
