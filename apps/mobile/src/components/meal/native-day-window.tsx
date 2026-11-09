import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEvent, type PagerViewOnPageSelectedEvent, type PageScrollStateChangedNativeEvent } from 'react-native-pager-view';
import Animated, { runOnJS, runOnUI, useEvent, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';

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
    // Adjust before children commit: external jumps create a fresh native view
    // at the target, never a command animating through intermediate days.
    setSession({ dateId, revision, active, width, baseDate: own ? session.baseDate : dateId,
      id: own ? session.id : session.id + 1 });
  }
  useLayoutEffect(() => {
    live.current = { ...props, active };
    currentSession.current = session.id;
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const settle = useCallback((index: number, expectedRevision: number, surface: number) => {
    if (!mounted.current || surface !== currentSession.current || !live.current.active || live.current.scrollEnabled === false ||
        live.current.readRevision() !== expectedRevision || !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return;
    const next = epochDayToDateId(dateIdToEpochDay(session.baseDate) - RADIUS + index);
    if (next === live.current.dateId && live.current.revision === expectedRevision) return expectedRevision;
    const pending = { dateId: next, revision: expectedRevision + 1 };
    acknowledgement.current = pending;
    const accepted = live.current.onSettle(next, expectedRevision);
    if (accepted !== pending.revision) {
      if (acknowledgement.current === pending) acknowledgement.current = null;
      return;
    }
    // Keep native indices stable for ordinary navigation. Only a window edge
    // rebases, after settling; this known visual-risk case needs phone review.
    if (index <= 1 || index >= PAGE_COUNT - 2) {
      setSession(previous => ({ ...previous, dateId: next, revision: accepted, baseDate: next, id: previous.id + 1 }));
    }
    return accepted;
  }, [session.baseDate]);

  if (!active) return <View style={styles.fill}>{props.renderDay(dateId)}</View>;
  return <NativeSurface key={session.id} baseDate={session.baseDate} surface={session.id}
    revision={revision} selectedDate={dateId} position={props.position} interaction={props.interaction}
    onSettle={settle} readRevision={props.readRevision} renderDay={props.renderDay} scrollEnabled={props.scrollEnabled !== false} />;
}

const NativeSurface = React.memo(function NativeSurface({ baseDate, surface, revision, selectedDate, position, interaction, onSettle, readRevision, renderDay, scrollEnabled }: {
  baseDate: string;
  surface: number;
  revision: number;
  selectedDate: string;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  onSettle: (index: number, revision: number, surface: number) => number | undefined;
  readRevision: () => number;
  renderDay: (date: string) => React.ReactNode;
  scrollEnabled: boolean;
}) {
  const firstDay = dateIdToEpochDay(baseDate) - RADIUS;
  const [prepared, setPrepared] = useState(false);
  const enabled = useSharedValue(true);
  // Discrete native events belong to PagerView's ordinary JS callback contract.
  // Do not depend on receipt/order of a separate UI scroll-state worklet to
  // accept onPageSelected. Intermediate scroll states may be absent/coalesced.
  const motion = useRef({ index: RADIUS, acknowledged: RADIUS, revision,
    expectedRevision: revision, generation: 0, phase: 'idle', initialized: false, mounted: true });
  const latest = useRef({ onSettle, readRevision });
  useLayoutEffect(() => { latest.current = { onSettle, readRevision }; }, [onSettle, readRevision]);
  useLayoutEffect(() => {
    motion.current.mounted = true;
    enabled.value = true;
    position.value = firstDay + RADIUS;
    interaction.value = 0;
    return () => { motion.current.mounted = false; motion.current.generation++; enabled.value = false; };
  }, [enabled, firstDay, interaction, position]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (motion.current.mounted && motion.current.phase === 'idle') setPrepared(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const reportIdle = useCallback((index: number, expectedRevision: number, token: number) => {
    const current = motion.current;
    if (!current.mounted || current.generation !== token || current.phase !== 'idle' ||
        current.revision !== expectedRevision || latest.current.readRevision() !== expectedRevision || current.acknowledged === index) return;
    setPrepared(true);
    const accepted = latest.current.onSettle(index, expectedRevision, surface);
    if (accepted === undefined) return;
    // Apply own acknowledgements immediately, even before React commits props:
    // a next native gesture can already be queued in this same event batch.
    current.revision = accepted;
    current.expectedRevision = accepted;
    current.acknowledged = index;
  }, [surface]);

  useLayoutEffect(() => {
    const current = motion.current;
    // Never regress an immediate own acknowledgement to older batched props.
    if (revision < current.revision) return;
    current.revision = revision;
    current.expectedRevision = revision;
    current.acknowledged = dateIdToEpochDay(selectedDate) - firstDay;
  }, [firstDay, revision, selectedDate]);

  const updatePresentation = useCallback((phase: number, index = -1) => {
    runOnUI((nextPhase: number, settledIndex: number) => {
      'worklet';
      if (!enabled.value) return;
      interaction.value = nextPhase;
      if (settledIndex >= 0) position.value = firstDay + settledIndex;
    })(phase, index);
  }, [enabled, firstDay, interaction, position]);

  // Only per-frame position uses a worklet; it never waits for a JS movement
  // flag and never renders React. The native pager still owns the actual motion.
  const pageScroll = useEvent<PagerViewOnPageScrollEvent>(event => {
    'worklet';
    if (enabled.value) position.value = firstDay + event.position + event.offset;
  }, ['onPageScroll']);
  const pageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const current = motion.current;
    const index = event.nativeEvent.position;
    if (!current.mounted || latest.current.readRevision() !== current.revision ||
        !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return;
    // Ignore the native attachment's placeholder selection before initialPage.
    if (!current.initialized && index !== RADIUS) return;
    current.initialized = true;
    if (current.index !== index) current.generation++;
    current.index = index;
  }, []);
  const pageState = useCallback((event: PageScrollStateChangedNativeEvent) => {
    const current = motion.current;
    if (!current.mounted || latest.current.readRevision() !== current.revision) return;
    const phase = event.nativeEvent.pageScrollState;
    if (phase === 'dragging') {
      current.generation++;
      current.expectedRevision = current.revision;
      current.initialized = true;
      current.phase = phase;
      updatePresentation(1);
    } else if (phase === 'settling') {
      if (current.phase === 'idle') {
        current.generation++;
        current.expectedRevision = current.revision;
      }
      current.phase = phase;
      updatePresentation(2);
    } else if (phase === 'idle') {
      current.phase = phase;
      updatePresentation(0, current.index);
      const { index, expectedRevision, generation } = current;
      // Let the current native event batch finish before committing: a newer
      // drag/selection, external command or blur invalidates this pending idle.
      runOnJS(reportIdle)(index, expectedRevision, generation);
    }
  }, [reportIdle, updatePresentation]);

  const dates = useMemo(() => Array.from({ length: PAGE_COUNT }, (_, i) => shiftDateId(baseDate, i - RADIUS)), [baseDate]);
  return <AnimatedPager style={styles.fill} initialPage={RADIUS} offscreenPageLimit={1}
    scrollEnabled={scrollEnabled}
    orientation="horizontal" layoutDirection="ltr" overScrollMode="never"
    onPageScroll={pageScroll} onPageSelected={pageSelected} onPageScrollStateChanged={pageState}>
    {dates.map(date => <View key={date} collapsable={false} style={styles.page}
      accessibilityElementsHidden={date !== selectedDate}
      importantForAccessibility={date === selectedDate ? 'auto' : 'no-hide-descendants'}>
      <NativeContent dateId={date} prepared={prepared || date === baseDate} renderDay={renderDay} />
    </View>)}
  </AnimatedPager>;
});

const NativeContent = React.memo(function NativeContent({ dateId, prepared, renderDay }: {
  dateId: string; prepared: boolean; renderDay: Props['renderDay'];
}) {
  return useMemo(() => prepared ? renderDay(dateId) : null, [dateId, prepared, renderDay]);
});
const styles = StyleSheet.create({ fill: { flex: 1 }, page: { width: '100%', height: '100%' } });
