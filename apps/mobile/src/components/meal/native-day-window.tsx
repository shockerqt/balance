import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEvent, type PagerViewOnPageSelectedEvent, type PageScrollStateChangedNativeEvent } from 'react-native-pager-view';
import Animated, { runOnJS, runOnUI, useEvent, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';
import { recordNativePagerEvent as tracePager } from '../../dev/native-pager-status';

const AnimatedPager = Animated.createAnimatedComponent(PagerView);
const RADIUS = 7;
const PAGE_COUNT = RADIUS * 2 + 1;
type Command = { dateId: string; revision: number; active: boolean; width: number };
type Session = Command & { baseDate: string; id: number };

type Props = {
  dateId: string;
  revision: number;
  readRevision: () => number;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  active?: boolean;
  scrollEnabled?: boolean;
  onSettle: (date: string, expectedRevision: number) => number | undefined;
  renderDay: (date: string) => React.ReactNode;
};

/** Android owns touch arbitration, fling and snapping. */
export function NativeDayWindow({ active = true, ...props }: Props) {
  const { width } = useWindowDimensions();
  const { dateId, revision } = props;
  const [session, setSession] = useState<Session>({ dateId, revision, active, width, baseDate: dateId, id: 0 });
  const acknowledgement = useRef<{ dateId: string; revision: number } | null>(null);
  const live = useRef({ ...props, active });
  const currentSession = useRef(session.id);
  const mounted = useRef(true);

  if (session.dateId !== dateId || session.revision !== revision || session.active !== active || session.width !== width) {
    const own = acknowledgement.current?.dateId === dateId && acknowledgement.current.revision === revision
      && session.active === active && session.width === width;
    const focusOnly = session.dateId === dateId && session.revision === revision && session.width === width;
    const keepSurface = own || focusOnly;
    // Adjust before children commit: external jumps create a fresh native view
    // at the target, never a command animating through intermediate days.
    setSession({ dateId, revision, active, width, baseDate: keepSurface ? session.baseDate : dateId,
      id: keepSurface ? session.id : session.id + 1 });
  }
  useLayoutEffect(() => {
    live.current = { ...props, active };
    currentSession.current = session.id;
  });
  useLayoutEffect(() => {
    tracePager('render', { index: dateIdToEpochDay(dateId) - dateIdToEpochDay(session.baseDate) + RADIUS, revision });
  }, [dateId, revision, session.baseDate]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const settle = useCallback((index: number, expectedRevision: number, surface: number) => {
    if (!mounted.current || surface !== currentSession.current || !live.current.active || live.current.scrollEnabled === false ||
        live.current.readRevision() !== expectedRevision || !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) {
      tracePager('rejected', { index, expected: expectedRevision, revision: live.current.readRevision(), reason:
        !mounted.current ? 'surface-unmounted' : surface !== currentSession.current ? 'old-surface' : !live.current.active ? 'inactive' :
          live.current.scrollEnabled === false ? 'selection-locked' : live.current.readRevision() !== expectedRevision ? 'root-revision' : 'invalid-index' });
      return;
    }
    const next = epochDayToDateId(dateIdToEpochDay(session.baseDate) - RADIUS + index);
    if (next === live.current.dateId && live.current.revision === expectedRevision) return expectedRevision;
    const pending = { dateId: next, revision: expectedRevision + 1 };
    acknowledgement.current = pending;
    const accepted = live.current.onSettle(next, expectedRevision);
    if (accepted !== pending.revision) {
      if (acknowledgement.current === pending) acknowledgement.current = null;
      tracePager('rejected', { index, expected: pending.revision, revision: accepted, reason: 'delegate-rejected' });
      return;
    }
    // Rebase baseDate at the window edge without changing `id` so the visible
    // `<View key={date}>` page stays mounted while centering the window.
    if (index <= 1 || index >= PAGE_COUNT - 2) {
      setSession(previous => ({ ...previous, dateId: next, revision: accepted, baseDate: next }));
    }
    return accepted;
  }, [session.baseDate]);

  return <NativeSurface key={session.id} baseDate={session.baseDate} surface={session.id}
    revision={revision} selectedDate={dateId} position={props.position} interaction={props.interaction}
    active={active} onSettle={settle} readRevision={props.readRevision} renderDay={props.renderDay}
    scrollEnabled={active && props.scrollEnabled !== false} />;
}

const NativeSurface = React.memo(function NativeSurface({ baseDate, surface, revision, selectedDate, position, interaction, active, onSettle, readRevision, renderDay, scrollEnabled }: {
  baseDate: string;
  surface: number;
  revision: number;
  selectedDate: string;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  active: boolean;
  onSettle: (index: number, revision: number, surface: number) => number | undefined;
  readRevision: () => number;
  renderDay: (date: string) => React.ReactNode;
  scrollEnabled: boolean;
}) {
  const firstDay = dateIdToEpochDay(baseDate) - RADIUS;
  const pagerRef = useRef<PagerView | null>(null);
  const [mountedRange, setMountedRange] = useState<{ min: number; max: number }>(() => ({
    min: RADIUS - 1,
    max: RADIUS + 1,
  }));
  const rangeRef = useRef(mountedRange);
  const prevBaseDateRef = useRef(baseDate);
  if (prevBaseDateRef.current !== baseDate) {
    prevBaseDateRef.current = baseDate;
    const resetRange = { min: RADIUS - 1, max: RADIUS + 1 };
    rangeRef.current = resetRange;
    setMountedRange(resetRange);
  } else {
    rangeRef.current = mountedRange;
  }
  const preloadFrameRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const cancelIdlePreload = useCallback(() => {
    if (preloadFrameRef.current !== null) {
      cancelAnimationFrame(preloadFrameRef.current);
      preloadFrameRef.current = null;
    }
  }, []);

  const enabled = useSharedValue(active);
  const motion = useRef({ index: RADIUS, acknowledged: RADIUS, revision,
    expectedRevision: revision, generation: 0, idleSequence: 0, phase: 'idle', initialized: false, mounted: true });
  const latest = useRef({ onSettle, readRevision });

  const scheduleIdlePreload = useCallback(() => {
    if (preloadFrameRef.current !== null || !activeRef.current) return;
    const step = () => {
      preloadFrameRef.current = null;
      if (!motion.current.mounted || motion.current.phase !== 'idle' || !activeRef.current) return;
      const center = motion.current.index;
      const { min, max } = rangeRef.current;
      if (min > 0 || max < PAGE_COUNT - 1) {
        const distLeft = center - min;
        const distRight = max - center;
        const expandLeft = min > 0 && (max >= PAGE_COUNT - 1 || distLeft <= distRight);
        const next = expandLeft ? { min: min - 1, max } : { min, max: max + 1 };
        rangeRef.current = next;
        setMountedRange(next);
        if (next.min > 0 || next.max < PAGE_COUNT - 1) {
          preloadFrameRef.current = requestAnimationFrame(step);
        }
      }
    };
    preloadFrameRef.current = requestAnimationFrame(step);
  }, []);

  useLayoutEffect(() => { latest.current = { onSettle, readRevision }; }, [onSettle, readRevision]);
  useLayoutEffect(() => {
    motion.current.mounted = true;
    enabled.value = active;
    position.value = firstDay + RADIUS;
    interaction.value = 0;
    tracePager('mount', { index: RADIUS, revision: motion.current.revision });
    return () => {
      motion.current.mounted = false;
      motion.current.generation++;
      enabled.value = false;
      cancelIdlePreload();
      tracePager('unmount');
    };
  }, [cancelIdlePreload, enabled, firstDay, interaction, position]);

  const appliedBaseDateRef = useRef(baseDate);
  useLayoutEffect(() => {
    if (appliedBaseDateRef.current !== baseDate) {
      appliedBaseDateRef.current = baseDate;
      motion.current.index = RADIUS;
      motion.current.acknowledged = RADIUS;
      motion.current.generation++;
      motion.current.phase = 'idle';
      position.value = firstDay + RADIUS;
      interaction.value = 0;
      pagerRef.current?.setPageWithoutAnimation?.(RADIUS);
      scheduleIdlePreload();
    }
  }, [baseDate, firstDay, interaction, position, scheduleIdlePreload]);

  const prevActiveRef = useRef(active);
  useLayoutEffect(() => {
    if (prevActiveRef.current !== active) {
      prevActiveRef.current = active;
      motion.current.generation++;
      motion.current.phase = 'idle';
      enabled.value = active;
      interaction.value = 0;
      position.value = dateIdToEpochDay(selectedDate);
      if (!active) cancelIdlePreload();
      else scheduleIdlePreload();
    }
  }, [active, cancelIdlePreload, enabled, interaction, position, scheduleIdlePreload, selectedDate]);

  useEffect(() => {
    if (active) scheduleIdlePreload();
    return () => cancelIdlePreload();
  }, [active, cancelIdlePreload, scheduleIdlePreload]);

  const reportIdle = useCallback((expectedRevision: number, token: number, idleSequence: number) => {
    const current = motion.current;
    const index = current.index;
    if (!current.mounted || !activeRef.current || current.generation !== token || current.phase !== 'idle' ||
        current.idleSequence !== idleSequence || current.revision !== expectedRevision ||
        latest.current.readRevision() !== expectedRevision || current.acknowledged === index) {
      tracePager(current.acknowledged === index ? 'skip' : 'rejected', { index, expected: expectedRevision, revision: latest.current.readRevision(), reason:
        !current.mounted ? 'unmounted' : !activeRef.current ? 'inactive' : current.generation !== token ? 'new-gesture' : current.phase !== 'idle' ? 'not-idle' :
          current.idleSequence !== idleSequence ? 'new-idle' : current.revision !== expectedRevision || latest.current.readRevision() !== expectedRevision ? 'revision' : 'same-index' });
      scheduleIdlePreload();
      return;
    }
    const nextMin = Math.max(0, Math.min(rangeRef.current.min, index - 1));
    const nextMax = Math.min(PAGE_COUNT - 1, Math.max(rangeRef.current.max, index + 1));
    if (nextMin !== rangeRef.current.min || nextMax !== rangeRef.current.max) {
      const nextRange = { min: nextMin, max: nextMax };
      rangeRef.current = nextRange;
      setMountedRange(nextRange);
    }
    const accepted = latest.current.onSettle(index, expectedRevision, surface);
    if (accepted === undefined) return;
    current.revision = accepted;
    current.expectedRevision = accepted;
    const previousIndex = current.acknowledged;
    current.acknowledged = index;
    tracePager('accepted', { index, revision: accepted });
    runOnUI((settledIndex: number, acknowledgedIndex: number) => {
      'worklet';
      if (!enabled.value) return;
      if (Math.abs(position.value - firstDay - acknowledgedIndex) < 0.001 ||
          Math.abs(position.value - firstDay - settledIndex) < 0.001) position.value = firstDay + settledIndex;
    })(index, previousIndex);
    scheduleIdlePreload();
  }, [enabled, firstDay, position, scheduleIdlePreload, surface]);

  useLayoutEffect(() => {
    const current = motion.current;
    if (revision < current.revision) return;
    current.revision = revision;
    current.expectedRevision = revision;
    current.acknowledged = dateIdToEpochDay(selectedDate) - firstDay;
  }, [firstDay, revision, selectedDate]);

  const updatePresentation = useCallback((phase: number) => {
    runOnUI((nextPhase: number) => {
      'worklet';
      if (!enabled.value) return;
      interaction.value = nextPhase;
    })(phase);
  }, [enabled, interaction]);

  const pageScroll = useEvent<PagerViewOnPageScrollEvent>(event => {
    'worklet';
    if (enabled.value) position.value = firstDay + event.position + event.offset;
  }, ['onPageScroll']);
  const pageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const current = motion.current;
    const index = event?.nativeEvent?.position;
    tracePager('selected', { index });
    if (index === undefined) { tracePager('rejected', { reason: 'selected-shape' }); return; }
    if (!current.mounted || !activeRef.current || latest.current.readRevision() !== current.revision ||
        !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) {
      tracePager('rejected', { index, expected: current.revision, revision: latest.current.readRevision(), reason:
        !current.mounted ? 'unmounted' : !activeRef.current ? 'inactive' : latest.current.readRevision() !== current.revision ? 'revision' : 'invalid-index' });
      return;
    }
    if (!current.initialized && index !== RADIUS) { tracePager('skip', { index, reason: 'await-initial-page' }); return; }
    current.initialized = true;
    current.index = index;
  }, []);
  const pageState = useCallback((event: PageScrollStateChangedNativeEvent) => {
    const current = motion.current;
    const phase = event?.nativeEvent?.pageScrollState;
    tracePager('state', { phase: phase === 'idle' || phase === 'dragging' || phase === 'settling' ? phase : 'missing' });
    if (phase === undefined) { tracePager('rejected', { reason: 'state-shape' }); return; }
    if (!current.mounted || !activeRef.current || latest.current.readRevision() !== current.revision) {
      tracePager('rejected', { expected: current.revision, revision: latest.current.readRevision(), reason: !current.mounted ? 'unmounted' : !activeRef.current ? 'inactive' : 'revision' });
      return;
    }
    if (phase === 'dragging') {
      cancelIdlePreload();
      current.generation++;
      current.expectedRevision = current.revision;
      current.initialized = true;
      current.phase = phase;
      updatePresentation(1);
    } else if (phase === 'settling') {
      cancelIdlePreload();
      if (current.phase === 'idle') {
        current.generation++;
        current.expectedRevision = current.revision;
      }
      current.phase = phase;
      updatePresentation(2);
    } else if (phase === 'idle') {
      current.phase = phase;
      updatePresentation(0);
      const { expectedRevision, generation } = current;
      const idleSequence = ++current.idleSequence;
      tracePager('queued', { index: current.index, expected: expectedRevision });
      runOnJS(reportIdle)(expectedRevision, generation, idleSequence);
    }
  }, [cancelIdlePreload, reportIdle, updatePresentation]);

  const dates = useMemo(() => Array.from({ length: PAGE_COUNT }, (_, i) => shiftDateId(baseDate, i - RADIUS)), [baseDate]);
  return <AnimatedPager ref={pagerRef} style={styles.fill} initialPage={RADIUS} offscreenPageLimit={1}
    scrollEnabled={scrollEnabled}
    orientation="horizontal" layoutDirection="ltr" overScrollMode="never"
    onPageScroll={pageScroll} onPageSelected={pageSelected} onPageScrollStateChanged={pageState}>
    {dates.map((date, pageIndex) => <View key={date} collapsable={false} style={styles.page}
      accessibilityElementsHidden={date !== selectedDate}
      importantForAccessibility={date === selectedDate ? 'auto' : 'no-hide-descendants'}>
      <NativeContent dateId={date} prepared={pageIndex >= mountedRange.min && pageIndex <= mountedRange.max} renderDay={renderDay} />
    </View>)}
  </AnimatedPager>;
});

const NativeContent = React.memo(function NativeContent({ dateId, prepared, renderDay }: {
  dateId: string; prepared: boolean; renderDay: Props['renderDay'];
}) {
  return useMemo(() => prepared ? renderDay(dateId) : null, [dateId, prepared, renderDay]);
});
const styles = StyleSheet.create({ fill: { flex: 1 }, page: { width: '100%', height: '100%' } });
