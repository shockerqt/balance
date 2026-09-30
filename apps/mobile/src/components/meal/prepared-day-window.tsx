import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { dateIdToEpochDay, shiftDateId } from '../../lib/dates';

/** Keep native layout fixed; only the UI-thread day position moves. */
export function PreparedDayWindow({ dateId, renderDay }: {
  dateId: string;
  renderDay: (dateId: string) => React.ReactNode;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [width, setWidth] = useState(screenWidth);
  const day = dateIdToEpochDay(dateId);
  const position = useSharedValue(day);
  const previous = useRef({ day, width });
  const dates = useMemo(() => [shiftDateId(dateId, -1), dateId, shiftDateId(dateId, 1)], [dateId]);

  useLayoutEffect(() => {
    cancelAnimation(position);
    const adjacent = Math.abs(day - previous.current.day) === 1 && width === previous.current.width;
    previous.current = { day, width };
    // Cancel from the current presentation position, without first jumping back.
    position.value = adjacent ? withTiming(day, {
      duration: 170,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    }) : day;
  }, [day, position, width]);
  useEffect(() => () => cancelAnimation(position), [position]);

  return (
    <View style={styles.viewport} onLayout={(event) => {
      const measured = event.nativeEvent.layout.width;
      if (measured > 0) setWidth(measured);
    }}>
      {dates.map((paneDateId) => (
        <PreparedDayPane key={paneDateId} dateId={paneDateId} active={paneDateId === dateId}
          position={position} width={width} renderDay={renderDay} />
      ))}
    </View>
  );
}

const PreparedDayPane = React.memo(function PreparedDayPane({ dateId, active, position, width, renderDay }: {
  dateId: string;
  active: boolean;
  position: SharedValue<number>;
  width: number;
  renderDay: (dateId: string) => React.ReactNode;
}) {
  const day = dateIdToEpochDay(dateId);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (day - position.value) * width }],
  }));
  return (
    <Animated.View style={[styles.pane, animatedStyle]} pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
      {renderDay(dateId)}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  pane: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
