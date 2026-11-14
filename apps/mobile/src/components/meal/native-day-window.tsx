import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import PagerView, { type PagerViewOnPageScrollEvent, type PagerViewOnPageSelectedEvent, type PageScrollStateChangedNativeEvent } from 'react-native-pager-view';
import Animated, { dispatchCommand, runOnJS, runOnUI, useAnimatedProps, useAnimatedRef, useEvent, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';
import { recordNativePagerEvent as tracePager, recordDiaryFrameIntervals, subscribeDiaryPresentationTrace } from '../../dev/native-pager-status';
import { createDiaryMotion, observePagerMotion, preparedNeighbors, type DiaryPagePresentation } from '../../lib/diary-presentation';

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
  renderDay: (date: string, presentation?: DiaryPagePresentation) => React.ReactNode;
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
  renderDay: Props['renderDay'];
  scrollEnabled: boolean;
}) {
  const firstDay = dateIdToEpochDay(baseDate) - RADIUS;
  const pagerRef = useAnimatedRef<PagerView>();
  const [prepared, setPrepared] = useState(false);
  const enabled = useSharedValue(true);
  const motionUI = useSharedValue(createDiaryMotion(firstDay + RADIUS, surface));
  const readyUI = useSharedValue<Record<string, boolean>>({});
  const headerTouchUI = useSharedValue(false);
  const allowedUI = useSharedValue(scrollEnabled);
  const traceFrames = useSharedValue(false);
  const frameIntervals = useSharedValue<number[]>([]);
  useEffect(() => subscribeDiaryPresentationTrace(enabled => {
    runOnUI((next: boolean) => {
      'worklet';
      traceFrames.value = next;
      if (next) frameIntervals.value = [];
      else if (frameIntervals.value.length) runOnJS(recordDiaryFrameIntervals)(frameIntervals.value);
    })(enabled);
  }), [frameIntervals, traceFrames]);
  useFrameCallback(frame => {
    if (traceFrames.value && frame.timeSincePreviousFrame !== null)
      frameIntervals.value = [...frameIntervals.value.slice(-239), frame.timeSincePreviousFrame];
  });
  useLayoutEffect(() => { allowedUI.value = scrollEnabled; }, [allowedUI, scrollEnabled]);
  const headerTouch = useCallback((down: boolean) => {
    'worklet';
    if (!enabled.value) return;
    headerTouchUI.value = down;
    dispatchCommand(pagerRef, 'setScrollEnabledImperatively', [!down && allowedUI.value && preparedNeighbors(motionUI.value.visual, readyUI.value)]);
  }, [allowedUI, enabled, headerTouchUI, motionUI, pagerRef, readyUI]);
  const presentation = useMemo<DiaryPagePresentation>(() => ({ motion: motionUI, ready: readyUI, interaction, headerTouch }),
    [headerTouch, interaction, motionUI, readyUI]);
  const pagerProps = useAnimatedProps(() => ({
    scrollEnabled: allowedUI.value && !headerTouchUI.value && preparedNeighbors(motionUI.value.visual, readyUI.value),
  }));
  // Discrete native events belong to PagerView's ordinary JS callback contract.
  // Do not depend on receipt/order of a separate UI scroll-state worklet to
  // accept onPageSelected. Intermediate scroll states may be absent/coalesced.
  const motion = useRef({ index: RADIUS, acknowledged: RADIUS, revision,
    expectedRevision: revision, generation: 0, idleSequence: 0, phase: 'idle', initialized: false, mounted: true });
  const latest = useRef({ onSettle, readRevision });
  useLayoutEffect(() => { latest.current = { onSettle, readRevision }; }, [onSettle, readRevision]);
  useLayoutEffect(() => {
    motion.current.mounted = true;
    enabled.value = true;
    motionUI.value = { ...motionUI.value, enabled: true };
    position.value = firstDay + RADIUS;
    interaction.value = 0;
    tracePager('mount', { index: RADIUS, revision: motion.current.revision });
    return () => {
      motion.current.mounted = false; motion.current.generation++; enabled.value = false;
      motionUI.value = { ...motionUI.value, enabled: false }; tracePager('unmount');
    };
  }, [enabled, firstDay, interaction, position]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (motion.current.mounted && motion.current.phase === 'idle') setPrepared(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const reportIdle = useCallback((expectedRevision: number, token: number, idleSequence: number) => {
    const current = motion.current;
    // Read selection after the batch: a coalesced idle event can occupy an
    // earlier dispatch slot than the non-coalescing selected-page event.
    const index = current.index;
    if (!current.mounted || current.generation !== token || current.phase !== 'idle' ||
        current.idleSequence !== idleSequence || current.revision !== expectedRevision ||
        latest.current.readRevision() !== expectedRevision || current.acknowledged === index) {
      tracePager(current.acknowledged === index ? 'skip' : 'rejected', { index, expected: expectedRevision, revision: latest.current.readRevision(), reason:
        !current.mounted ? 'unmounted' : current.generation !== token ? 'new-gesture' : current.phase !== 'idle' ? 'not-idle' :
          current.idleSequence !== idleSequence ? 'new-idle' : current.revision !== expectedRevision || latest.current.readRevision() !== expectedRevision ? 'revision' : 'same-index' });
      return;
    }
    setPrepared(true);
    const accepted = latest.current.onSettle(index, expectedRevision, surface);
    if (accepted === undefined) return;
    // Apply own acknowledgements immediately, even before React commits props:
    // a next native gesture can already be queued in this same event batch.
    current.revision = accepted;
    current.expectedRevision = accepted;
    const previousIndex = current.acknowledged;
    current.acknowledged = index;
    tracePager('accepted', { index, revision: accepted });
    runOnUI((settledIndex: number, acknowledgedIndex: number) => {
      'worklet';
      if (!enabled.value) return;
      // Reconcile a missing/rounded final frame without pulling the marker
      // back if the UI is already following a newer native gesture.
      if (Math.abs(position.value - firstDay - acknowledgedIndex) < 0.001 ||
          Math.abs(position.value - firstDay - settledIndex) < 0.001) position.value = firstDay + settledIndex;
    })(index, previousIndex);
  }, [enabled, firstDay, position, surface]);

  useLayoutEffect(() => {
    const current = motion.current;
    // Never regress an immediate own acknowledgement to older batched props.
    if (revision < current.revision) return;
    current.revision = revision;
    current.expectedRevision = revision;
    current.acknowledged = dateIdToEpochDay(selectedDate) - firstDay;
  }, [firstDay, revision, selectedDate]);

  // Only per-frame position uses a worklet; it never waits for a JS movement
  // flag and never renders React. The native pager still owns the actual motion.
  const pageScroll = useEvent<{ nativeEvent: PagerViewOnPageScrollEvent['nativeEvent'] & { pageScrollState?: string } }>(event => {
    'worklet';
    if (!enabled.value) return;
    const previous = motionUI.value;
    let next = previous;
    if (event.eventName.endsWith('onPageScrollStateChanged')) {
      const phase = event.pageScrollState;
      if (phase !== 'idle' && phase !== 'dragging' && phase !== 'settling') return;
      const value = phase === 'idle' ? 0 : phase === 'dragging' ? 1 : 2;
      interaction.value = value;
      next = observePagerMotion(previous, 'state', value);
    } else if (event.eventName.endsWith('onPageSelected')) {
      next = observePagerMotion(previous, 'selected', firstDay + event.position);
    } else {
      position.value = firstDay + event.position + event.offset;
      next = observePagerMotion(previous, 'scroll', position.value);
    }
    if (next.visual !== previous.visual) {
      // Invalidate the outgoing page before publishing visual idle. A reversal
      // stays gated until its native/core/committed range all return to zero.
      readyUI.value = { ...readyUI.value, [String(previous.visual)]: false };
    }
    motionUI.value = next;
  }, ['onPageScroll', 'onPageSelected', 'onPageScrollStateChanged']);
  const pageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const current = motion.current;
    const index = event?.nativeEvent?.position;
    tracePager('selected', { index });
    if (index === undefined) { tracePager('rejected', { reason: 'selected-shape' }); return; }
    if (!current.mounted || latest.current.readRevision() !== current.revision ||
        !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) {
      tracePager('rejected', { index, expected: current.revision, revision: latest.current.readRevision(), reason:
        !current.mounted ? 'unmounted' : latest.current.readRevision() !== current.revision ? 'revision' : 'invalid-index' });
      return;
    }
    // Ignore the native attachment's placeholder selection before initialPage.
    if (!current.initialized && index !== RADIUS) { tracePager('skip', { index, reason: 'await-initial-page' }); return; }
    current.initialized = true;
    current.index = index;
  }, []);
  const pageState = useCallback((event: PageScrollStateChangedNativeEvent) => {
    const current = motion.current;
    const phase = event?.nativeEvent?.pageScrollState;
    tracePager('state', { phase: phase === 'idle' || phase === 'dragging' || phase === 'settling' ? phase : 'missing' });
    if (phase === undefined) { tracePager('rejected', { reason: 'state-shape' }); return; }
    if (!current.mounted || latest.current.readRevision() !== current.revision) {
      tracePager('rejected', { expected: current.revision, revision: latest.current.readRevision(), reason: !current.mounted ? 'unmounted' : 'revision' });
      return;
    }
    if (phase === 'dragging') {
      current.generation++;
      current.expectedRevision = current.revision;
      current.initialized = true;
      current.phase = phase;
    } else if (phase === 'settling') {
      if (current.phase === 'idle') {
        current.generation++;
        current.expectedRevision = current.revision;
      }
      current.phase = phase;
    } else if (phase === 'idle') {
      current.phase = phase;
      const { expectedRevision, generation } = current;
      const idleSequence = ++current.idleSequence;
      tracePager('queued', { index: current.index, expected: expectedRevision });
      // Let the current native event batch finish before committing: a newer
      // drag/selection, external command or blur invalidates this pending idle.
      runOnJS(reportIdle)(expectedRevision, generation, idleSequence);
    }
  }, [reportIdle]);

  const dates = useMemo(() => Array.from({ length: PAGE_COUNT }, (_, i) => shiftDateId(baseDate, i - RADIUS)), [baseDate]);
  return <AnimatedPager ref={pagerRef} animatedProps={pagerProps} style={styles.fill} initialPage={RADIUS} offscreenPageLimit={1}
    scrollEnabled={scrollEnabled}
    orientation="horizontal" layoutDirection="ltr" overScrollMode="never"
    onPageScroll={pageScroll} onPageSelected={pageSelected} onPageScrollStateChanged={pageState}>
    {dates.map(date => <View key={date} collapsable={false} style={styles.page}
      accessibilityElementsHidden={date !== selectedDate}
      importantForAccessibility={date === selectedDate ? 'auto' : 'no-hide-descendants'}>
      <NativeContent dateId={date} prepared={prepared || date === baseDate} renderDay={renderDay} presentation={presentation} />
    </View>)}
  </AnimatedPager>;
});

const NativeContent = React.memo(function NativeContent({ dateId, prepared, renderDay, presentation }: {
  dateId: string; prepared: boolean; renderDay: Props['renderDay']; presentation: DiaryPagePresentation;
}) {
  return useMemo(() => prepared ? renderDay(dateId, presentation) : null, [dateId, prepared, presentation, renderDay]);
});
const styles = StyleSheet.create({ fill: { flex: 1 }, page: { width: '100%', height: '100%' } });
