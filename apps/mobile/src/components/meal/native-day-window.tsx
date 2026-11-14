import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEvent, type PagerViewOnPageSelectedEvent, type PageScrollStateChangedNativeEvent } from 'react-native-pager-view';
import Animated, { runOnJS, runOnUI, useEvent, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId } from '../../lib/dates';
import { recordNativePagerEvent as tracePager } from '../../dev/native-pager-status';

const AnimatedPager = Animated.createAnimatedComponent(PagerView);
export const NATIVE_WINDOW_RADIUS = 30;
const RADIUS = NATIVE_WINDOW_RADIUS;
const PAGE_COUNT = RADIUS * 2 + 1;
const EDGE_MARGIN = 4;
const INITIAL_RADIUS = 1;
const ACTIVE_TARGET_RADIUS = 2;
const IDLE_PRELOAD_RADIUS = 4;
const RETENTION_TARGET = IDLE_PRELOAD_RADIUS * 2 + 1;
const CENTER_PAIR_KEY = RADIUS * PAGE_COUNT + RADIUS;
const SCROLL_EPSILON = 1e-4;

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

function createInitialPreparedDays(centerDay: number): ReadonlySet<number> {
  const next = new Set<number>();
  for (let offset = -INITIAL_RADIUS; offset <= INITIAL_RADIUS; offset++) {
    next.add(centerDay + offset);
  }
  return next;
}

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

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
    // Rebase baseDate near the window edge without changing `id` so the visible
    // `<View key={date}>` page stays mounted while centering the window.
    if (index <= EDGE_MARGIN || index >= PAGE_COUNT - 1 - EDGE_MARGIN) {
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
  const firstDayRef = useRef(firstDay);
  const pagerRef = useRef<PagerView | null>(null);
  const [preparedDays, setPreparedDays] = useState<ReadonlySet<number>>(() => createInitialPreparedDays(firstDay + RADIUS));
  const preparedDaysRef = useRef<ReadonlySet<number>>(preparedDays);
  const preloadFrameRef = useRef<number | null>(null);
  const activeRef = useRef(active);

  const cancelIdlePreload = useCallback(() => {
    if (preloadFrameRef.current !== null) {
      cancelAnimationFrame(preloadFrameRef.current);
      preloadFrameRef.current = null;
    }
  }, []);

  const enabled = useSharedValue(active);
  const firstDayShared = useSharedValue(firstDay);
  const baseVersionShared = useSharedValue(0);
  const rebasingFromShared = useSharedValue(-1);
  const lastVisiblePair = useSharedValue(CENTER_PAIR_KEY);

  const motion = useRef({
    index: RADIUS,
    acknowledged: RADIUS,
    visMin: RADIUS,
    visMax: RADIUS,
    baseVersion: 0,
    rebasingFrom: null as number | null,
    revision,
    expectedRevision: revision,
    generation: 0,
    idleSequence: 0,
    phase: 'idle',
    initialized: false,
    mounted: true,
  });
  const latest = useRef({ onSettle, readRevision });

  const applyPreparedSet = useCallback((required: ReadonlySet<number>, anchorDay: number, minDay: number, maxDay: number, forceRangeClamp = false) => {
    const currentSet = preparedDaysRef.current;
    if (!forceRangeClamp) {
      let allPresent = true;
      for (const day of required) {
        if (!currentSet.has(day)) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) return;
    }
    const next = new Set<number>();
    for (const day of required) {
      if (day >= minDay && day <= maxDay) next.add(day);
    }
    const retained: number[] = [];
    for (const day of currentSet) {
      if (day >= minDay && day <= maxDay && !next.has(day)) {
        retained.push(day);
      }
    }
    if (next.size < RETENTION_TARGET && retained.length > 0) {
      retained.sort((a, b) => Math.abs(a - anchorDay) - Math.abs(b - anchorDay));
      for (const day of retained) {
        if (next.size >= RETENTION_TARGET) break;
        next.add(day);
      }
    }
    if (setsEqual(currentSet, next)) return;
    preparedDaysRef.current = next;
    setPreparedDays(next);
  }, []);

  const prepareTargetNeighborhood = useCallback((targetIndex: number) => {
    const fDay = firstDayRef.current;
    const lDay = fDay + PAGE_COUNT - 1;
    const targetDay = fDay + targetIndex;
    const required = new Set<number>();
    for (let d = Math.max(fDay, targetDay - ACTIVE_TARGET_RADIUS); d <= Math.min(lDay, targetDay + ACTIVE_TARGET_RADIUS); d++) {
      required.add(d);
    }
    const visMinDay = fDay + Math.max(0, Math.min(PAGE_COUNT - 1, motion.current.visMin));
    const visMaxDay = fDay + Math.max(0, Math.min(PAGE_COUNT - 1, motion.current.visMax));
    for (let d = visMinDay; d <= visMaxDay; d++) {
      required.add(d);
    }
    applyPreparedSet(required, targetDay, fDay, lDay);
  }, [applyPreparedSet]);

  const scheduleIdlePreload = useCallback(() => {
    if (!motion.current.mounted || preloadFrameRef.current !== null || !activeRef.current) return;
    const step = () => {
      preloadFrameRef.current = null;
      if (!motion.current.mounted || motion.current.phase !== 'idle' || !activeRef.current) return;
      const fDay = firstDayRef.current;
      const lDay = fDay + PAGE_COUNT - 1;
      const centerDay = fDay + motion.current.index;
      const idleMin = Math.max(fDay, centerDay - IDLE_PRELOAD_RADIUS);
      const idleMax = Math.min(lDay, centerDay + IDLE_PRELOAD_RADIUS);
      const currentSet = preparedDaysRef.current;

      let missingDay: number | null = null;
      if (centerDay >= idleMin && centerDay <= idleMax && !currentSet.has(centerDay)) {
        missingDay = centerDay;
      } else {
        for (let dist = 1; dist <= IDLE_PRELOAD_RADIUS; dist++) {
          const left = centerDay - dist;
          const right = centerDay + dist;
          if (left >= idleMin && !currentSet.has(left)) {
            missingDay = left;
            break;
          }
          if (right <= idleMax && !currentSet.has(right)) {
            missingDay = right;
            break;
          }
        }
      }

      if (missingDay !== null) {
        const next = new Set<number>();
        for (const day of currentSet) {
          if (day >= fDay && day <= lDay) next.add(day);
        }
        next.add(missingDay);
        if (next.size > RETENTION_TARGET) {
          const removable = [...next]
            .filter(day => day < idleMin || day > idleMax)
            .sort((a, b) => Math.abs(b - centerDay) - Math.abs(a - centerDay));
          for (const day of removable) {
            if (next.size <= RETENTION_TARGET) break;
            next.delete(day);
          }
        }
        if (!setsEqual(currentSet, next)) {
          preparedDaysRef.current = next;
          setPreparedDays(next);
        }
        let stillNeedsWork = next.size > RETENTION_TARGET;
        if (!stillNeedsWork) {
          for (let d = idleMin; d <= idleMax; d++) {
            if (!next.has(d)) {
              stillNeedsWork = true;
              break;
            }
          }
        }
        if (stillNeedsWork) {
          preloadFrameRef.current = requestAnimationFrame(step);
        }
        return;
      }

      if (currentSet.size > RETENTION_TARGET) {
        const next = new Set<number>();
        for (let d = idleMin; d <= idleMax; d++) {
          if (currentSet.has(d)) next.add(d);
        }
        if (!setsEqual(currentSet, next)) {
          preparedDaysRef.current = next;
          setPreparedDays(next);
        }
      }
    };
    preloadFrameRef.current = requestAnimationFrame(step);
  }, []);

  useLayoutEffect(() => {
    latest.current = { onSettle, readRevision };
    firstDayRef.current = firstDay;
    activeRef.current = active;
  }, [active, firstDay, onSettle, readRevision]);
  useLayoutEffect(() => {
    const initialFirstDay = firstDayRef.current;
    motion.current.mounted = true;
    enabled.value = activeRef.current;
    firstDayShared.value = initialFirstDay;
    position.value = initialFirstDay + RADIUS;
    interaction.value = 0;
    tracePager('mount', { index: RADIUS, revision: motion.current.revision });
    return () => {
      motion.current.mounted = false;
      motion.current.generation++;
      enabled.value = false;
      cancelIdlePreload();
      tracePager('unmount');
    };
  }, [cancelIdlePreload, enabled, firstDayShared, interaction, position]);

  const appliedBaseDateRef = useRef(baseDate);
  useLayoutEffect(() => {
    if (appliedBaseDateRef.current !== baseDate) {
      appliedBaseDateRef.current = baseDate;
      cancelIdlePreload();
      const oldIndex = motion.current.index;
      const nextBaseVersion = ++motion.current.baseVersion;
      motion.current.rebasingFrom = oldIndex !== RADIUS ? oldIndex : null;
      motion.current.index = RADIUS;
      motion.current.acknowledged = RADIUS;
      motion.current.visMin = RADIUS;
      motion.current.visMax = RADIUS;
      motion.current.generation++;
      motion.current.phase = 'idle';
      firstDayShared.value = firstDay;
      baseVersionShared.value = nextBaseVersion;
      rebasingFromShared.value = oldIndex !== RADIUS ? oldIndex : -1;
      lastVisiblePair.value = CENTER_PAIR_KEY;
      position.value = firstDay + RADIUS;
      interaction.value = 0;

      const lDay = firstDay + PAGE_COUNT - 1;
      const centerDay = firstDay + RADIUS;
      const required = new Set<number>();
      for (let d = Math.max(firstDay, centerDay - ACTIVE_TARGET_RADIUS); d <= Math.min(lDay, centerDay + ACTIVE_TARGET_RADIUS); d++) {
        required.add(d);
      }
      applyPreparedSet(required, centerDay, firstDay, lDay, true);
      pagerRef.current?.setPageWithoutAnimation?.(RADIUS);
      scheduleIdlePreload();
    }
  }, [applyPreparedSet, baseDate, baseVersionShared, cancelIdlePreload, firstDay, firstDayShared, interaction, lastVisiblePair, position, rebasingFromShared, scheduleIdlePreload]);

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
    prepareTargetNeighborhood(index);
    const accepted = latest.current.onSettle(index, expectedRevision, surface);
    if (accepted === undefined) return;
    current.revision = accepted;
    current.expectedRevision = accepted;
    const previousIndex = current.acknowledged;
    current.acknowledged = index;
    tracePager('accepted', { index, revision: accepted });
    const fDay = firstDayRef.current;
    runOnUI((settledIndex: number, acknowledgedIndex: number, baseFirstDay: number) => {
      'worklet';
      if (!enabled.value) return;
      if (Math.abs(position.value - baseFirstDay - acknowledgedIndex) < 0.001 ||
          Math.abs(position.value - baseFirstDay - settledIndex) < 0.001) position.value = baseFirstDay + settledIndex;
    })(index, previousIndex, fDay);
    scheduleIdlePreload();
  }, [enabled, position, prepareTargetNeighborhood, scheduleIdlePreload, surface]);

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

  const clearRebasingFilter = useCallback((baseVersion: number) => {
    if (motion.current.mounted && motion.current.baseVersion === baseVersion) {
      motion.current.rebasingFrom = null;
    }
  }, []);

  const handleVisiblePair = useCallback((visMin: number, visMax: number, baseVersion: number) => {
    const current = motion.current;
    if (!current.mounted || !activeRef.current || baseVersion !== current.baseVersion || current.rebasingFrom !== null) {
      return;
    }
    current.visMin = visMin;
    current.visMax = visMax;
    const fDay = firstDayRef.current;
    const lDay = fDay + PAGE_COUNT - 1;
    const targetDay = fDay + current.index;
    const required = new Set<number>();
    for (let d = Math.max(fDay, targetDay - ACTIVE_TARGET_RADIUS); d <= Math.min(lDay, targetDay + ACTIVE_TARGET_RADIUS); d++) {
      required.add(d);
    }
    for (let i = Math.max(0, visMin - 1); i <= Math.min(PAGE_COUNT - 1, visMax + 1); i++) {
      required.add(fDay + i);
    }
    const anchorIndex = visMax > current.index ? visMax : visMin < current.index ? visMin : current.index;
    applyPreparedSet(required, fDay + anchorIndex, fDay, lDay);
  }, [applyPreparedSet]);

  const pageScroll = useEvent<PagerViewOnPageScrollEvent>(event => {
    'worklet';
    if (!enabled.value) return;
    const raw = event.position + event.offset;
    const rebasingFrom = rebasingFromShared.value;
    if (rebasingFrom >= 0) {
      if (Math.abs(raw - rebasingFrom) < 1.5 && Math.abs(raw - RADIUS) > 1.5) return;
      rebasingFromShared.value = -1;
      runOnJS(clearRebasingFilter)(baseVersionShared.value);
    }
    position.value = firstDayShared.value + raw;
    const visMin = Math.max(0, Math.min(PAGE_COUNT - 1, Math.floor(raw + SCROLL_EPSILON)));
    const visMax = Math.max(0, Math.min(PAGE_COUNT - 1, Math.ceil(raw - SCROLL_EPSILON)));
    const pairKey = visMin * PAGE_COUNT + visMax;
    if (pairKey !== lastVisiblePair.value) {
      lastVisiblePair.value = pairKey;
      runOnJS(handleVisiblePair)(visMin, visMax, baseVersionShared.value);
    }
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
    if (current.rebasingFrom !== null) {
      if (index === current.rebasingFrom) {
        tracePager('skip', { index, reason: 'await-initial-page' });
        return;
      }
      current.rebasingFrom = null;
      rebasingFromShared.value = -1;
    }
    if (!current.initialized && index !== RADIUS) { tracePager('skip', { index, reason: 'await-initial-page' }); return; }
    const isInitialCenterAck = !current.initialized && index === RADIUS && current.phase === 'idle';
    current.initialized = true;
    current.index = index;
    current.visMin = index;
    current.visMax = index;
    if (!isInitialCenterAck) {
      prepareTargetNeighborhood(index);
    }
  }, [prepareTargetNeighborhood, rebasingFromShared]);

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
      current.rebasingFrom = null;
      rebasingFromShared.value = -1;
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
  }, [cancelIdlePreload, rebasingFromShared, reportIdle, updatePresentation]);

  const pages = useMemo(
    () => Array.from({ length: PAGE_COUNT }, (_, i) => {
      const epochDay = firstDay + i;
      return { date: epochDayToDateId(epochDay), epochDay };
    }),
    [firstDay],
  );
  return <AnimatedPager ref={pagerRef} style={styles.fill} initialPage={RADIUS} offscreenPageLimit={1}
    scrollEnabled={scrollEnabled}
    orientation="horizontal" layoutDirection="ltr" overScrollMode="never"
    onPageScroll={pageScroll} onPageSelected={pageSelected} onPageScrollStateChanged={pageState}>
    {pages.map(({ date, epochDay }) => <View key={date} collapsable={false} style={styles.page}
      accessibilityElementsHidden={date !== selectedDate}
      importantForAccessibility={date === selectedDate ? 'auto' : 'no-hide-descendants'}>
      <NativeContent dateId={date} prepared={preparedDays.has(epochDay)} renderDay={renderDay} />
    </View>)}
  </AnimatedPager>;
});

const NativeContent = React.memo(function NativeContent({ dateId, prepared, renderDay }: {
  dateId: string; prepared: boolean; renderDay: Props['renderDay'];
}) {
  return useMemo(() => prepared ? renderDay(dateId) : null, [dateId, prepared, renderDay]);
});
const styles = StyleSheet.create({ fill: { flex: 1 }, page: { width: '100%', height: '100%' } });
