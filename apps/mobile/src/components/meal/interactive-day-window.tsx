import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, ReduceMotion, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';
import { acceptDaySettle, dayPagerOffset } from '../../lib/day-pager';

const PREPARED_RADIUS = 2;
type Window = { dateId: string; radius: number };
type Acknowledgement = { dateId: string; revision: number };

/** Fixed absolute calendar-day layout. React never handles drag frames. */
export function InteractiveDayWindow({ dateId, revision, readRevision, position, interaction, active = true, onSettle, renderDay }: {
  dateId: string;
  revision: number;
  readRevision: () => number;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  active?: boolean;
  onSettle: (date: string, expectedRevision: number) => number | undefined;
  renderDay: (date: string) => React.ReactNode;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [width, setWidth] = useState(screenWidth);
  const day = dateIdToEpochDay(dateId);
  const [prepared, setPrepared] = useState<Window>({ dateId, radius: PREPARED_RADIUS });
  const acknowledgement = useRef<Acknowledgement | null>(null);
  const committed = useRef({ day, revision, width, active });
  const commandChanged = committed.current.day !== day || committed.current.revision !== revision;
  const ownAcknowledgement = acknowledgement.current?.dateId === dateId && acknowledgement.current.revision === revision;
  const externalCommand = commandChanged && !ownAcknowledgement;
  // A distant external command mounts its target in the first commit, then
  // prepares neighbors. Speculative release preparation never commands the date.
  const window = externalCommand
    ? { dateId, radius: Math.abs(day - committed.current.day) > 1 ? 0 : PREPARED_RADIUS }
    : prepared;
  const center = dateIdToEpochDay(window.dateId);
  const lower = center - window.radius, upper = center + window.radius;
  const neighborsReady = window.radius > 0;
  const dates = useMemo(() => Array.from({ length: window.radius * 2 + 1 }, (_, i) =>
    shiftDateId(window.dateId, i - window.radius)), [window.dateId, window.radius]);

  const destination = useSharedValue(day);
  const dragOrigin = useSharedValue(day);
  const gestureBase = useSharedValue(day);
  const lowerBound = useSharedValue(lower);
  const upperBound = useSharedValue(upper);
  const commandRevision = useSharedValue(revision);
  const gestureRevision = useSharedValue(revision);
  const generation = useSharedValue(0);
  const uiSession = useSharedValue(0);
  const commandSession = useRef(0);
  const gestureGeneration = useSharedValue(0);
  const enabled = useSharedValue(active);
  const dragging = useSharedValue(false);
  const latest = useRef({ dateId, revision, readRevision, active, onSettle });
  const mounted = useRef(true);

  useLayoutEffect(() => { latest.current = { dateId, revision, readRevision, active, onSettle }; });

  const prepareDestination = useCallback((target: number, token: number, session: number) => {
    if (!mounted.current || session !== commandSession.current || token !== generation.value || !latest.current.active || interaction.value === 1) return;
    const next = epochDayToDateId(target);
    setPrepared(previous => previous.dateId === next && previous.radius === PREPARED_RADIUS
      ? previous : { dateId: next, radius: PREPARED_RADIUS });
  }, [generation, interaction]);

  const reportEnd = useCallback((target: number, expectedRevision: number, token: number, session: number) => {
    if (!mounted.current || session !== commandSession.current || token !== generation.value ||
        expectedRevision !== latest.current.readRevision() ||
        !acceptDaySettle(expectedRevision, latest.current.revision, latest.current.active)) return;
    const next = epochDayToDateId(target);
    if (next === latest.current.dateId) return;
    // Set before the store notification: an acknowledgement may render
    // synchronously, and must never cancel a newer drag already in progress.
    const pending = { dateId: next, revision: expectedRevision + 1 };
    acknowledgement.current = pending;
    const accepted = latest.current.onSettle(next, expectedRevision);
    if (accepted !== pending.revision && acknowledgement.current === pending) acknowledgement.current = null;
  }, [generation]);

  const animateToDestination = useCallback((velocity: number) => {
    'worklet';
    const target = destination.value;
    const visibleTarget = Math.max(lowerBound.value, Math.min(upperBound.value, target));
    const token = generation.value;
    const session = uiSession.value;
    interaction.value = 2;
    position.value = withSpring(visibleTarget, {
      stiffness: 900, damping: 60, mass: 1, energyThreshold: 0.0001, velocity,
      overshootClamping: true, reduceMotion: ReduceMotion.System,
    }, finished => {
      if (!finished || generation.value !== token || !enabled.value || dragging.value) return;
      // If JS was busy through several flicks, hold the rendered edge rather
      // than reveal an unprepared day. Preparation resumes the latest intent.
      if (visibleTarget !== destination.value) {
        runOnJS(prepareDestination)(destination.value, token, session);
        return;
      }
      interaction.value = 0;
      runOnJS(reportEnd)(target, commandRevision.value, token, session);
    });
  }, [commandRevision, destination, dragging, enabled, generation, interaction, lowerBound, position, prepareDestination, reportEnd, uiSession, upperBound]);

  useLayoutEffect(() => {
    const previous = committed.current;
    const own = acknowledgement.current?.dateId === dateId && acknowledgement.current.revision === revision;
    const preserved = own && previous.width === width && previous.active === active;
    committed.current = { day, revision, width, active };
    acknowledgement.current = null;
    if (!preserved) commandSession.current += 1;
    runOnUI((keepPresentation: boolean, nextDay: number, nextRevision: number, isActive: boolean, ready: boolean, session: number) => {
      'worklet';
      commandRevision.value = nextRevision;
      uiSession.value = session;
      if (keepPresentation) {
        // Acknowledgement and a simultaneous next pan are serialized on the UI
        // thread; JavaScript cannot reset a gesture between these operations.
        if (gestureGeneration.value === generation.value) gestureRevision.value = nextRevision;
        if (interaction.value === 0 && destination.value !== nextDay) animateToDestination(0);
        return;
      }
      generation.value += 1;
      cancelAnimation(position);
      destination.value = nextDay;
      position.value = nextDay;
      dragging.value = false;
      interaction.value = 0;
      enabled.value = isActive && ready;
    })(preserved, day, revision, active, neighborsReady, commandSession.current);
    if (preserved) return;
    if (externalCommand || previous.width !== width || previous.active !== active) {
      const radius = externalCommand && Math.abs(day - previous.day) > 1 ? 0 : PREPARED_RADIUS;
      setPrepared(current => current.dateId === dateId && current.radius === radius ? current : { dateId, radius });
    }
    // Only actual authority commands, focus and geometry changes reset motion.
    // Neighbor preparation is deliberately excluded from this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, revision, width, active]);

  useLayoutEffect(() => {
    runOnUI((nextLower: number, nextUpper: number, isActive: boolean, ready: boolean) => {
      'worklet';
      lowerBound.value = nextLower;
      upperBound.value = nextUpper;
      enabled.value = isActive && ready;
      if (isActive && ready && interaction.value === 2 && !dragging.value) {
        // A long JS stall can coalesce many releases. Reveal the prepared
        // destination before paint instead of moving through missing panes.
        if (position.value < nextLower || position.value > nextUpper) position.value = destination.value;
        animateToDestination(0);
      }
    })(lower, upper, active, neighborsReady);
  }, [active, animateToDestination, destination, dragging, enabled, interaction, lower, lowerBound, neighborsReady, position, upper, upperBound]);
  useEffect(() => {
    if (neighborsReady) return;
    const frame = requestAnimationFrame(() => setPrepared({ dateId, radius: PREPARED_RADIUS }));
    return () => cancelAnimationFrame(frame);
  }, [dateId, neighborsReady]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; enabled.value = false; cancelAnimation(position); };
  }, [enabled, position]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(active).maxPointers(1).activeOffsetX([-16, 16]).failOffsetY([-12, 12])
    .onBegin(() => {
      gestureRevision.value = commandRevision.value;
      gestureGeneration.value = generation.value;
    })
    .onStart(() => {
      if (!enabled.value || gestureRevision.value !== commandRevision.value || gestureGeneration.value !== generation.value) return;
      // Grab a settling page exactly where it is. Never wait for a spring tail
      // or a React acknowledgement before accepting another horizontal gesture.
      generation.value += 1;
      gestureGeneration.value = generation.value;
      cancelAnimation(position);
      dragOrigin.value = position.value;
      gestureBase.value = destination.value;
      dragging.value = true;
      interaction.value = 1;
    })
    .onUpdate(event => {
      if (!dragging.value || gestureRevision.value !== commandRevision.value || gestureGeneration.value !== generation.value) return;
      position.value = Math.max(lowerBound.value, Math.min(upperBound.value, dragOrigin.value - event.translationX / width));
    })
    .onEnd((event, success) => {
      if (!dragging.value) return;
      dragging.value = false;
      destination.value = gestureBase.value + dayPagerOffset(event.translationX, event.velocityX, width, success);
      animateToDestination(-event.velocityX / width);
      runOnJS(prepareDestination)(destination.value, generation.value, uiSession.value);
    })
    .onFinalize(() => {
      if (!dragging.value) return;
      dragging.value = false;
      destination.value = gestureBase.value;
      animateToDestination(0);
      runOnJS(prepareDestination)(destination.value, generation.value, uiSession.value);
    }), [active, animateToDestination, commandRevision, destination, dragOrigin, dragging, enabled,
    generation, gestureBase, gestureGeneration, gestureRevision, interaction, lowerBound, position, prepareDestination, uiSession, upperBound, width]);

  return <GestureDetector gesture={gesture}>
    <View collapsable={false} style={styles.viewport} onLayout={event => {
      const measured = event.nativeEvent.layout.width;
      if (measured > 0) setWidth(measured);
    }}>
      {dates.map(date => <DayPane key={date} dateId={date} active={active && date === dateId}
        position={position} width={width} renderDay={renderDay} />)}
    </View>
  </GestureDetector>;
}

const DayPane = React.memo(function DayPane({ dateId, active, position, width, renderDay }: {
  dateId: string; active: boolean; position: SharedValue<number>; width: number;
  renderDay: (date: string) => React.ReactNode;
}) {
  const day = dateIdToEpochDay(dateId);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (day - position.value) * width }] }));
  return <Animated.View style={[styles.pane, style]} pointerEvents={active ? 'auto' : 'none'}
    accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
    {renderDay(dateId)}
  </Animated.View>;
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  pane: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
