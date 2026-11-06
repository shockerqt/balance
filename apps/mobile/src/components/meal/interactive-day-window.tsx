import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';
import { acceptDaySettle, dayPagerOffset } from '../../lib/day-pager';

/** Evolves PreparedDayWindow's fixed absolute layout; React never handles frames. */
export function InteractiveDayWindow({ dateId, revision, position, interaction, active = true, onSettle, renderDay }: {
  dateId: string;
  revision: number;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  active?: boolean;
  onSettle: (date: string, expectedRevision: number) => void;
  renderDay: (date: string) => React.ReactNode;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [width, setWidth] = useState(screenWidth);
  const day = dateIdToEpochDay(dateId);
  const previousDay = useRef(day);
  const [preparedDate, setPreparedDate] = useState(dateId);
  const dates = useMemo(() => Math.abs(previousDay.current - day) > 1 && preparedDate !== dateId
    ? [dateId] : [shiftDateId(dateId, -1), dateId, shiftDateId(dateId, 1)], [dateId, day, preparedDate]);
  const neighborsReady = dates.length === 3;
  useLayoutEffect(() => { previousDay.current = day; }, [day]);
  useEffect(() => {
    if (neighborsReady) return;
    const frame = requestAnimationFrame(() => setPreparedDate(dateId));
    return () => cancelAnimationFrame(frame);
  }, [dateId, neighborsReady]);
  const anchor = useSharedValue(day);
  const commandRevision = useSharedValue(revision);
  const gestureRevision = useSharedValue(revision);
  const generation = useSharedValue(0);
  const gestureGeneration = useSharedValue(0);
  const enabled = useSharedValue(active);
  const dragging = useSharedValue(false);
  const settling = useSharedValue(false);
  const latest = useRef({ revision, active, onSettle });
  const mounted = useRef(true);

  useLayoutEffect(() => {
    latest.current = { revision, active, onSettle };
  });
  useLayoutEffect(() => {
    generation.value += 1;
    cancelAnimation(position);
    anchor.value = day;
    position.value = day;
    commandRevision.value = revision;
    enabled.value = active && neighborsReady;
    dragging.value = false;
    settling.value = false;
    interaction.value = 0;
    // External commands, including adjacent calendar selections, snap directly.
    // A settled acknowledgement is already at this position and never animates.
  }, [day, revision, width, active, anchor, commandRevision, dragging, enabled, generation, interaction, neighborsReady, position, settling]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; enabled.value = false; cancelAnimation(position); };
  }, [enabled, position]);

  const reportEnd = useCallback((target: number, expectedRevision: number, expectedGeneration: number) => {
    if (!mounted.current || expectedGeneration !== generation.value) return;
    if (acceptDaySettle(expectedRevision, latest.current.revision, latest.current.active)) {
      latest.current.onSettle(epochDayToDateId(target), expectedRevision);
    }
  }, [generation]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(active).maxPointers(1).activeOffsetX([-16, 16]).failOffsetY([-12, 12])
    .onBegin(() => {
      gestureRevision.value = commandRevision.value;
      gestureGeneration.value = generation.value;
    })
    .onStart(() => {
      if (!enabled.value || settling.value || gestureRevision.value !== commandRevision.value ||
          gestureGeneration.value !== generation.value) return;
      dragging.value = true;
      interaction.value = 1;
    })
    .onUpdate(event => {
      if (!dragging.value || gestureRevision.value !== commandRevision.value || gestureGeneration.value !== generation.value) return;
      position.value = anchor.value + Math.max(-1, Math.min(1, -event.translationX / width));
    })
    .onEnd((event, success) => {
      if (!dragging.value) return;
      dragging.value = false;
      settling.value = true;
      interaction.value = 2;
      const offset = dayPagerOffset(event.translationX, event.velocityX, width, success);
      const target = anchor.value + offset;
      const expected = gestureRevision.value;
      const token = generation.value;
      position.value = withSpring(target, {
        stiffness: 900, damping: 120, mass: 1, velocity: -event.velocityX / width,
        overshootClamping: true, reduceMotion: ReduceMotion.System,
      }, finished => {
        if (!finished || generation.value !== token || !enabled.value) return;
        // Lock changed pages until React has installed their prepared neighbors.
        interaction.value = 0;
        if (!offset) settling.value = false;
        if (offset) runOnJS(reportEnd)(target, expected, token);
      });
    })
    .onFinalize(() => {
      if (!dragging.value) return;
      dragging.value = false;
      interaction.value = 0;
      position.value = withSpring(anchor.value, { reduceMotion: ReduceMotion.System });
    }), [active, anchor, commandRevision, dragging, enabled, generation, gestureGeneration, gestureRevision, interaction, position, reportEnd, settling, width]);

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
