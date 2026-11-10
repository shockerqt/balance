import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useAuth } from '../../hooks/use-auth';
import { useMealDay } from '../../hooks/use-meal-store';
import { logsDateStore, useLogsDateRevision, useLogsSelectedDate } from '../../hooks/use-logs-date';
import { dateIdToEpochDay } from '../../lib/dates';
import { createPagerDiagnostics } from '../../dev/pager-diagnostics';
import { Button, Screen, Text } from '../ui';
import { DateStripHeader } from './date-strip-header';
import { StickyMacroHeader } from './sticky-macro-header';
import { InteractiveDayWindow } from './interactive-day-window';
import { NativeDayWindow } from './native-day-window';
import { RecyclingHourRailFeed, type RecyclingListEngine } from './recycling-hour-rail-feed';

const noop = () => {};

/** Read-only comparison: same actual day, cells and overscan for both engines. */
export default function ReactNativeLogSpike() {
  const { user } = useAuth();
  return <AccountSpike key={user?.id ?? 'guest'} />;
}

function AccountSpike() {
  const router = useRouter();
  const active = useIsFocused();
  const [date, setDate] = useLogsSelectedDate();
  const revision = useLogsDateRevision();
  const [engine, setEngine] = useState<RecyclingListEngine>('legend');
  const [pagerEngine, setPagerEngine] = useState<'native' | 'custom'>('native');
  const [report, setReport] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const position = useSharedValue(dateIdToEpochDay(date));
  const interaction = useSharedValue(0);
  const scrolling = useSharedValue(false);
  const collecting = useSharedValue(false);
  const focused = useSharedValue(active);
  const frames = useSharedValue({ count: 0, totalMs: 0, maxMs: 0, over25ms: 0 });
  const diagnostics = useMemo(createPagerDiagnostics, []);
  const acknowledging = useRef(false);
  useEffect(() => logsDateStore.subscribe(() => {
    if (!acknowledging.current) diagnostics.command('jump');
  }), [diagnostics]);
  useEffect(() => {
    focused.value = active;
    if (!active) scrolling.value = false;
  }, [active, focused, scrolling]);
  // Keep a trial alive through the calendar route so its return can be measured;
  // only visible interaction contributes UI frames. Unmount ends the trial.
  useEffect(() => () => {
    collecting.value = false;
    diagnostics.stop();
  }, [collecting, diagnostics]);

  useFrameCallback(frame => {
    if (!collecting.value || !focused.value || (interaction.value === 0 && !scrolling.value) || frame.timeSincePreviousFrame === null) return;
    const ms = frame.timeSincePreviousFrame;
    const old = frames.value;
    frames.value = { count: old.count + 1, totalMs: old.totalMs + ms,
      maxMs: Math.max(old.maxMs, ms), over25ms: old.over25ms + (ms > 25 ? 1 : 0) };
  });
  const settle = useCallback((target: string, revision: number) => {
    // Recheck the live authority; React props can lag a calendar command.
    if (logsDateStore.getRevision() !== revision) return;
    if (target === logsDateStore.get()) return logsDateStore.getRevision();
    acknowledging.current = true;
    diagnostics.command('settle');
    try { logsDateStore.set(target); return logsDateStore.getRevision(); }
    finally { acknowledging.current = false; }
  }, [diagnostics]);
  const renderDay = useCallback((dateId: string) => <SpikeDay dateId={dateId} engine={engine} scrolling={scrolling} />, [engine, scrolling]);
  const start = () => {
    frames.value = { count: 0, totalMs: 0, maxMs: 0, over25ms: 0 };
    setReport(null);
    setCapturing(true);
    diagnostics.start();
    collecting.value = true;
  };
  const stop = () => {
    collecting.value = false;
    diagnostics.stop();
    setCapturing(false);
    const result = diagnostics.results();
    const timing = frames.value;
    setReport(JSON.stringify({ engine, pagerEngine, mode: __DEV__ ? 'debug' : 'development-client-minified',
      // React's production renderer normally disables Profiler callbacks.
      // Missing samples must NEVER be reported as evidence of zero commits.
      reactCommitEvidence: result.commits ? result : 'unavailable: use a profiling renderer',
      uiFrames: { ...timing, meanMs: timing.count ? timing.totalMs / timing.count : null },
    }, null, 2));
  };
  const DayWindow = pagerEngine === 'native' ? NativeDayWindow : InteractiveDayWindow;
  return <Profiler id="rn-log-spike" onRender={(_id, _phase, duration, _base, _start, commitTime) => {
    diagnostics.commit(active ? interaction.value : -1, duration, commitTime);
  }}>
    <Screen>
      <View style={{ padding: 12, gap: 8 }}>
        <Text variant="title">Comparar diario React Native</Text>
        <Text variant="caption" tone="secondary">Solo lectura · {pagerEngine === 'native' ? 'Pager Android' : 'Pager experimental'} · {engine === 'flash' ? 'FlashList' : 'Legend List'} · {__DEV__ ? 'JavaScript debug' : 'JavaScript minificado en Dev client'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button size="md" style={{ paddingHorizontal: 12 }} title="Volver" variant="secondary" onPress={() => router.back()} />
          <Button size="md" style={{ paddingHorizontal: 12 }} title={engine === 'flash' ? 'Usar Legend' : 'Usar FlashList'} variant="secondary"
            disabled={capturing} onPress={() => { setEngine(engine === 'flash' ? 'legend' : 'flash'); setReport(null); }} />
          <Button size="md" style={{ paddingHorizontal: 12 }} title={pagerEngine === 'native' ? 'Usar movimiento anterior' : 'Usar movimiento Android'}
            variant="secondary" disabled={capturing} onPress={() => { setPagerEngine(pagerEngine === 'native' ? 'custom' : 'native'); setReport(null); }} />
          <Button size="md" style={{ paddingHorizontal: 12 }} title={capturing ? 'Detener' : 'Medir'} onPress={capturing ? stop : start} />
        </View>
      </View>
      <DateStripHeader selectedDateId={date} onSelectDate={setDate} onShiftDate={logsDateStore.shift} pagerPosition={position} pagerInteraction={interaction} active={active} />
      {report ? <ScrollView style={{ maxHeight: 220 }}><Text selectable variant="caption">{report}</Text></ScrollView> : null}
      <DayWindow dateId={date} revision={revision} readRevision={logsDateStore.getRevision} position={position}
        interaction={interaction} active={active} onSettle={settle} renderDay={renderDay} />
    </Screen>
  </Profiler>;
}

const SpikeDay = React.memo(function SpikeDay({ dateId, engine, scrolling }: {
  dateId: string; engine: RecyclingListEngine; scrolling: SharedValue<boolean>;
}) {
  const log = useMealDay(dateId);
  const beginScroll = useCallback(() => { scrolling.value = true; }, [scrolling]);
  const endScroll = useCallback(() => { scrolling.value = false; }, [scrolling]);
  return <>
    <StickyMacroHeader foods={log.foods} targetCalories={log.targetCalories}
      targetProtein={log.targetProtein} targetCarbs={log.targetCarbs} targetFat={log.targetFat} targetFiber={log.targetFiber} />
    <RecyclingHourRailFeed engine={engine} foods={log.foods} onSelectFood={noop} onAddAtHour={noop}
      onScrollBeginDrag={beginScroll} onScrollEndDrag={endScroll}
      onMomentumScrollBegin={beginScroll} onMomentumScrollEnd={endScroll} />
  </>;
});
