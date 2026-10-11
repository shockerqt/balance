import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { BalanceDailyLogView } from '../../../../modules/balance-daily-log';
import { Screen } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { useTheme } from '@/theme';
import { currentTimeString, todayId } from '@/lib/dates';
import { acceptDailyEvent, projectDays } from './daily-log-contract';

export default function NativeDailyLogScreen() {
  const { user, isGuest } = useAuth();
  // Account changes replace the native tree and invalidate all queued events.
  return <DailyLogSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}
let sessionCounter = 0;
const freshSession = () => `daily-${Date.now()}-${++sessionCounter}`;
function DailyLogSession() {
  const router = useRouter();
  const meals = useMealStore();
  const weight = useWeightStore();
  const preferences = usePreferencesStore();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [selected] = useLogsSelectedDate();
  const [session, setSession] = useState(freshSession);
  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState(todayId);
  const live = useRef({ alive: true, focused: false, sequence: 0, nativeDate: '', session, applyingNative: false, commandRevision: logsDateStore.getRevision() });
  useFocusEffect(useCallback(() => {
    live.current.focused = true;
    live.current.session = freshSession();
    live.current.sequence = 0;
    live.current.nativeDate = '';
    setSession(live.current.session);
    setFocused(true);
    return () => { live.current.focused = false; setFocused(false); };
  }, []));
  useEffect(() => {
    live.current.alive = true;
    setMounted(true);
    const unsubscribe = logsDateStore.subscribe(() => {
      if (!live.current.applyingNative) {
        live.current.commandRevision = logsDateStore.getRevision();
        live.current.nativeDate = '';
      }
    });
    const updateToday = () => setToday(todayId());
    const subscription = AppState.addEventListener('change', updateToday);
    const timer = setInterval(updateToday, 60_000);
    return () => { live.current.alive = false; unsubscribe(); subscription.remove(); clearInterval(timer); };
  }, []);
  const data = useMemo(() => JSON.stringify({
    session, today, colors: theme.colors,
    showWeight: preferences.preferencesReady && preferences.weightTrackingEnabled,
    weightError: weight.syncError,
    days: mounted ? projectDays(meals.dayLogs, weight.weightsByDate) : {},
    empty: projectDays({ [today]: emptyDayLog(today) }, {})[today],
  }), [session, today, theme.colors, preferences.preferencesReady, preferences.weightTrackingEnabled, weight.syncError, weight.weightsByDate, meals.dayLogs, mounted]);
  const dateCommand = JSON.stringify({ date: selected, fromNative: live.current.nativeDate === selected, revision: live.current.commandRevision });
  return <Screen><BalanceDailyLogView style={{ flex: 1 }} data={data} dateCommand={dateCommand} active={focused && mounted}
    onAction={({ nativeEvent: e }) => {
      if (!live.current.alive || !live.current.focused || !mounted || !acceptDailyEvent(e, live.current.session, live.current.sequence, logsDateStore.get(), meals.dayLogs, live.current.commandRevision)) return;
      live.current.sequence = e.sequence;
      if (e.action === 'date') {
        live.current.nativeDate = e.date;
        live.current.applyingNative = true;
        try { logsDateStore.set(e.date); } finally { live.current.applyingNative = false; }
      } else if (e.action === 'add') router.push({ pathname: '/food-search', params: { dateId: e.date, time: e.time ?? currentTimeString() } });
      else if (e.action === 'edit') router.push({ pathname: '/food-edit', params: { dateId: e.date, foodId: e.ids![0] } });
      else if (e.action === 'weight' && preferences.weightTrackingEnabled && e.date <= todayId()) router.push({ pathname: '/weight-entry', params: { dateId: e.date } });
      else if (e.action === 'delete') meals.deleteMultipleFoods(e.date, e.ids!);
      else if (e.action === 'move') meals.moveMultipleFoodsTime(e.date, e.ids!, e.time!);
    }} /></Screen>;
}
