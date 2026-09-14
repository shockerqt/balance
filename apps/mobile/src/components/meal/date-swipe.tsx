import React, { useMemo, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { logsDateStore } from '@/hooks/use-logs-date';
import { swipeDateOffset } from '@/lib/log-navigation';

/** Discrete navigation: one completed horizontal gesture, one date command. */
export function DateSwipe({ children, days = 1, disabled = false, style }: {
  children: React.ReactNode;
  days?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const startRevision = useRef<number | null>(null);
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .maxPointers(1)
    .activeOffsetX([-24, 24])
    .failOffsetY([-16, 16])
    .runOnJS(true)
    .onBegin(() => { startRevision.current = logsDateStore.getRevision(); })
    .onEnd((event, success) => {
      const revision = startRevision.current;
      startRevision.current = null;
      const offset = swipeDateOffset(event.translationX, event.translationY, success);
      if (revision !== null && offset !== 0) logsDateStore.shift(offset * days, revision);
    })
    .onFinalize(() => { startRevision.current = null; }), [days, disabled]);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={style}>{children}</View>
    </GestureDetector>
  );
}
