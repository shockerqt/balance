import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, runOnJS, runOnUI, useAnimatedReaction, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { logsDateStore, useLogsDateRevision } from '@/hooks/use-logs-date';
import { shiftDateId } from '@/lib/dates';

/** Local presentation only. One accepted release sends one existing date command. */
export function useWeekStripSwipe({ dateId, active, width, interaction, onSelectDate, onHeaderTouch }: {
  dateId: string;
  active: boolean;
  width: SharedValue<number>;
  interaction?: SharedValue<number>;
  onSelectDate: (date: string) => void;
  onHeaderTouch?: (down: boolean) => void;
}) {
  const revision = useLogsDateRevision();
  const offset = useSharedValue(0);
  const phase = useSharedValue(0);
  const generation = useSharedValue(0);
  const liveRevision = useSharedValue(revision);
  const touchRevision = useSharedValue(-1);
  const origin = useSharedValue(0);
  const latest = useRef({ dateId, active, onSelectDate, mounted: true });

  useAnimatedReaction(() => interaction?.value ?? 0, moving => {
    if (!moving || !phase.value) return;
    generation.value++;
    cancelAnimation(offset);
    phase.value = 0;
    offset.value = 0;
  });

  useLayoutEffect(() => {
    latest.current = { dateId, active, onSelectDate, mounted: true };
    runOnUI((nextRevision: number) => {
      'worklet';
      generation.value++;
      liveRevision.value = nextRevision;
      cancelAnimation(offset);
      phase.value = 0;
      offset.value = 0;
    })(revision);
    return () => {
      latest.current.mounted = false;
      runOnUI(() => {
        'worklet';
        generation.value++;
        cancelAnimation(offset);
        phase.value = 0;
        offset.value = 0;
      })();
    };
  }, [dateId, revision, active, onSelectDate, generation, liveRevision, offset, phase]);

  const commit = useCallback((weeks: number, expected: number, serial: number) => {
    const current = latest.current;
    if (generation.value !== serial) return;
    if (current.mounted && current.active && (interaction?.value ?? 0) === 0 &&
        logsDateStore.getRevision() === expected) {
      current.onSelectDate(shiftDateId(current.dateId, weeks * 7));
    } else {
      runOnUI((token: number) => {
        'worklet';
        if (generation.value === token) { phase.value = 0; offset.value = 0; }
      })(serial);
    }
  }, [generation, interaction, offset, phase]);

  const setWidth = useCallback((measured: number) => {
    runOnUI((next: number) => {
      'worklet';
      if (width.value === next) return;
      generation.value++;
      cancelAnimation(offset);
      phase.value = 0;
      offset.value = 0;
      width.value = next;
    })(Math.max(1, measured));
  }, [generation, offset, phase, width]);

  const gesture = useMemo(() => {
    const settle = (target: number) => {
      'worklet';
      phase.value = 2;
      const serial = generation.value;
      const expected = touchRevision.value;
      offset.value = withTiming(target, { duration: 180 }, finished => {
        if (!finished || generation.value !== serial) return;
        if (target === 0) phase.value = 0;
        else runOnJS(commit)(target, expected, serial);
      });
    };
    return Gesture.Pan().enabled(active).maxPointers(1)
      .activeOffsetX([-16, 16]).failOffsetY([-16, 16])
      .onTouchesDown(() => { onHeaderTouch?.(true); })
      .onTouchesUp(() => { onHeaderTouch?.(false); })
      .onTouchesCancelled(() => { onHeaderTouch?.(false); })
      .onBegin(() => { touchRevision.value = liveRevision.value; })
      .onStart(() => {
        if (width.value <= 1 || touchRevision.value !== liveRevision.value || (interaction?.value ?? 0) !== 0) return;
        generation.value++;
        cancelAnimation(offset);
        origin.value = offset.value;
        phase.value = 1;
      })
      .onUpdate(event => {
        if (phase.value !== 1 || touchRevision.value !== liveRevision.value || (interaction?.value ?? 0) !== 0) return;
        offset.value = Math.max(-1, Math.min(1, origin.value - event.translationX / width.value));
      })
      .onEnd((event, success) => {
        if (phase.value !== 1) return;
        const projected = offset.value - event.velocityX / width.value * 0.12;
        settle(success && Math.abs(projected) > 0.2 ? Math.sign(projected) : 0);
      })
      .onFinalize(() => { onHeaderTouch?.(false); if (phase.value === 1) settle(0); });
  }, [active, commit, generation, interaction, liveRevision, offset, onHeaderTouch, origin, phase, touchRevision, width]);

  return { gesture, offset, phase, setWidth };
}
