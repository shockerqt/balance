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
  onSettle: (date: string, expectedRevision: number) => number | undefined;
  renderDay: (date: string) => React.ReactNode;
};

/** Development comparison: Android owns touch arbitration, fling and snapping. */
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
    if (!mounted.current || surface !== currentSession.current || !live.current.active ||
        live.current.readRevision() !== expectedRevision || !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return;
    const next = epochDayToDateId(dateIdToEpochDay(session.baseDate) - RADIUS + index);
    if (next === live.current.dateId) return;
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
  }, [session.baseDate]);

  if (!active) return <View style={styles.fill}>{props.renderDay(dateId)}</View>;
  return <NativeSurface key={session.id} baseDate={session.baseDate} surface={session.id}
    revision={revision} selectedDate={dateId} position={props.position} interaction={props.interaction}
    onSettle={settle} renderDay={props.renderDay} />;
}

const NativeSurface = React.memo(function NativeSurface({ baseDate, surface, revision, selectedDate, position, interaction, onSettle, renderDay }: {
  baseDate: string;
  surface: number;
  revision: number;
  selectedDate: string;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  onSettle: (index: number, revision: number, surface: number) => void;
  renderDay: (date: string) => React.ReactNode;
}) {
  const firstDay = dateIdToEpochDay(baseDate) - RADIUS;
  const [prepared, setPrepared] = useState(false);
  const selected = useSharedValue(RADIUS);
  const commandRevision = useSharedValue(revision);
  const dragRevision = useSharedValue(revision);
  const generation = useSharedValue(0);
  const enabled = useSharedValue(true);
  const moved = useSharedValue(false);
  const initialized = useSharedValue(false);
  const mounted = useRef(true);
  const latest = useRef(onSettle);
  useLayoutEffect(() => { latest.current = onSettle; }, [onSettle]);
  useLayoutEffect(() => {
    mounted.current = true;
    enabled.value = true;
    position.value = firstDay + RADIUS;
    interaction.value = 0;
    return () => { mounted.current = false; enabled.value = false; };
  }, [enabled, firstDay, interaction, position]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (mounted.current && interaction.value === 0) setPrepared(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [interaction]);

  const reportIdle = useCallback((index: number, expectedRevision: number, token: number) => {
    if (!mounted.current || !enabled.value || generation.value !== token || interaction.value !== 0) return;
    setPrepared(true);
    latest.current(index, expectedRevision, surface);
  }, [enabled, generation, interaction, surface]);

  useLayoutEffect(() => {
    runOnUI((nextRevision: number, acknowledgedIndex: number) => {
      'worklet';
      commandRevision.value = nextRevision;
      dragRevision.value = nextRevision;
      // Native motion may finish while JS is applying an earlier settle.
      if (enabled.value && interaction.value === 0 && selected.value !== acknowledgedIndex) {
        runOnJS(reportIdle)(selected.value, nextRevision, generation.value);
      }
    })(revision, dateIdToEpochDay(selectedDate) - firstDay);
  }, [commandRevision, dragRevision, enabled, firstDay, generation, interaction, reportIdle, revision, selected, selectedDate]);

  const pageScroll = useEvent<PagerViewOnPageScrollEvent>(event => {
    'worklet';
    if (enabled.value && moved.value) position.value = firstDay + event.position + event.offset;
  }, ['onPageScroll']);
  const pageSelected = useEvent<PagerViewOnPageSelectedEvent>(event => {
    'worklet';
    if (!enabled.value) return;
    if (moved.value || (!initialized.value && event.position === RADIUS)) {
      selected.value = event.position;
      initialized.value = true;
    }
  }, ['onPageSelected']);
  const pageState = useEvent<PageScrollStateChangedNativeEvent>(event => {
    'worklet';
    if (!enabled.value) return;
    if (event.pageScrollState === 'dragging') {
      generation.value += 1;
      dragRevision.value = commandRevision.value;
      moved.value = true;
      initialized.value = true;
      interaction.value = 1;
    } else if (event.pageScrollState === 'settling') {
      if (!moved.value && initialized.value) {
        generation.value += 1;
        dragRevision.value = commandRevision.value;
        moved.value = true;
      }
      interaction.value = 2;
    } else if (event.pageScrollState === 'idle') {
      interaction.value = 0;
      position.value = firstDay + selected.value;
      if (moved.value) {
        moved.value = false;
        runOnJS(reportIdle)(selected.value, dragRevision.value, generation.value);
      }
    }
  }, ['onPageScrollStateChanged']);

  const dates = useMemo(() => Array.from({ length: PAGE_COUNT }, (_, i) => shiftDateId(baseDate, i - RADIUS)), [baseDate]);
  return <AnimatedPager style={styles.fill} initialPage={RADIUS} offscreenPageLimit={1}
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
