import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { runOnUI, useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { dateIdToEpochDay, epochDayToDateId, shiftDateId } from '../../lib/dates';

const RADIUS = 180;
const PAGE_COUNT = RADIUS * 2 + 1;
const keyExtractor = (date: string) => date;

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

/** Horizontal recycled list pager powered by AnimatedLegendList + UI-thread sharedValues. */
export function LegendDayWindow({ active = true, scrollEnabled = true, ...props }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const width = screenWidth > 0 ? screenWidth : 400;
  const { dateId, revision } = props;
  const [session, setSession] = useState<Session>({ dateId, revision, active, width, baseDate: dateId, id: 0 });
  const acknowledgement = useRef<{ dateId: string; revision: number } | null>(null);
  const live = useRef({ ...props, active, scrollEnabled });
  const currentSession = useRef(session.id);
  const mounted = useRef(true);

  if (session.dateId !== dateId || session.revision !== revision || session.active !== active || session.width !== width) {
    const own = acknowledgement.current?.dateId === dateId && acknowledgement.current.revision === revision
      && session.active === active && session.width === width;
    const focusOnly = session.dateId === dateId && session.revision === revision && session.width === width;
    const targetOffset = dateIdToEpochDay(dateId) - dateIdToEpochDay(session.baseDate);
    const inWindow = session.width === width && Math.abs(targetOffset) <= RADIUS - 3;
    const keepSurface = own || focusOnly || inWindow;
    setSession({
      dateId,
      revision,
      active,
      width,
      baseDate: keepSurface ? session.baseDate : dateId,
      id: keepSurface ? session.id : session.id + 1,
    });
  }

  useLayoutEffect(() => {
    live.current = { ...props, active, scrollEnabled };
    currentSession.current = session.id;
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const settle = useCallback((index: number, expectedRevision: number, surface: number) => {
    if (!mounted.current || surface !== currentSession.current || !live.current.active || !live.current.scrollEnabled ||
        live.current.readRevision() !== expectedRevision || !Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) {
      return;
    }
    const next = epochDayToDateId(dateIdToEpochDay(session.baseDate) - RADIUS + index);
    if (next === live.current.dateId && live.current.revision === expectedRevision) return expectedRevision;
    const pending = { dateId: next, revision: expectedRevision + 1 };
    acknowledgement.current = pending;
    const accepted = live.current.onSettle(next, expectedRevision);
    if (accepted !== pending.revision) {
      if (acknowledgement.current === pending) acknowledgement.current = null;
      return;
    }
    if (index <= 2 || index >= PAGE_COUNT - 3) {
      setSession(previous => ({ ...previous, dateId: next, revision: accepted, baseDate: next }));
    }
    return accepted;
  }, [session.baseDate]);

  return (
    <LegendSurface
      key={session.id}
      baseDate={session.baseDate}
      surface={session.id}
      width={width}
      revision={revision}
      selectedDate={dateId}
      position={props.position}
      interaction={props.interaction}
      active={active}
      scrollEnabled={active && scrollEnabled}
      onSettle={settle}
      readRevision={props.readRevision}
      renderDay={props.renderDay}
    />
  );
}

const LegendSurface = React.memo(function LegendSurface({
  baseDate,
  surface,
  width,
  revision,
  selectedDate,
  position,
  interaction,
  active,
  scrollEnabled,
  onSettle,
  readRevision,
  renderDay,
}: {
  baseDate: string;
  surface: number;
  width: number;
  revision: number;
  selectedDate: string;
  position: SharedValue<number>;
  interaction: SharedValue<number>;
  active: boolean;
  scrollEnabled: boolean;
  onSettle: (index: number, revision: number, surface: number) => number | undefined;
  readRevision: () => number;
  renderDay: (date: string) => React.ReactNode;
}) {
  const firstDay = dateIdToEpochDay(baseDate) - RADIUS;
  const scrollOffset = useSharedValue(RADIUS * width);
  const enabled = useSharedValue(active && scrollEnabled);
  const listRef = useRef<{ scrollToOffset: (options: { offset: number; animated: boolean }) => unknown } | null>(null);
  const attach = useCallback((value: typeof listRef.current) => { listRef.current = value; }, []);
  const motion = useRef({
    index: RADIUS,
    acknowledged: RADIUS,
    revision,
    expectedRevision: revision,
    generation: 0,
    phase: 'idle' as 'idle' | 'dragging' | 'settling',
    mounted: true,
  });
  const latest = useRef({ onSettle, readRevision, active, scrollEnabled });
  useLayoutEffect(() => {
    latest.current = { onSettle, readRevision, active, scrollEnabled };
  }, [active, onSettle, readRevision, scrollEnabled]);

  useAnimatedReaction(
    () => scrollOffset.value,
    (offset) => {
      if (enabled.value && width > 0) {
        position.value = firstDay + offset / width;
      }
    }
  );

  useLayoutEffect(() => {
    motion.current.mounted = true;
    enabled.value = active && scrollEnabled;
    position.value = dateIdToEpochDay(selectedDate);
    interaction.value = 0;
    return () => {
      motion.current.mounted = false;
      motion.current.generation++;
      enabled.value = false;
    };
  }, [enabled, interaction, position]);

  const appliedBaseDateRef = useRef(baseDate);
  useLayoutEffect(() => {
    if (appliedBaseDateRef.current !== baseDate) {
      appliedBaseDateRef.current = baseDate;
      motion.current.index = RADIUS;
      motion.current.acknowledged = RADIUS;
      motion.current.generation++;
      motion.current.phase = 'idle';
      scrollOffset.value = RADIUS * width;
      position.value = firstDay + RADIUS;
      interaction.value = 0;
      listRef.current?.scrollToOffset({ offset: RADIUS * width, animated: false });
    }
  }, [baseDate, firstDay, interaction, position, scrollOffset, width]);

  const prevLockRef = useRef({ active, scrollEnabled });
  useLayoutEffect(() => {
    if (prevLockRef.current.active !== active || prevLockRef.current.scrollEnabled !== scrollEnabled) {
      prevLockRef.current = { active, scrollEnabled };
      motion.current.generation++;
      motion.current.phase = 'idle';
      enabled.value = active && scrollEnabled;
      interaction.value = 0;
      position.value = dateIdToEpochDay(selectedDate);
    }
  }, [active, enabled, interaction, position, scrollEnabled, selectedDate]);

  useLayoutEffect(() => {
    const current = motion.current;
    if (revision < current.revision) return;
    const nextIndex = dateIdToEpochDay(selectedDate) - firstDay;
    const isExternalJump = nextIndex !== current.acknowledged && nextIndex >= 0 && nextIndex < PAGE_COUNT;
    current.revision = revision;
    current.expectedRevision = revision;
    current.acknowledged = nextIndex;
    if (isExternalJump) {
      current.index = nextIndex;
      current.generation++;
      current.phase = 'idle';
      scrollOffset.value = nextIndex * width;
      position.value = firstDay + nextIndex;
      interaction.value = 0;
      listRef.current?.scrollToOffset({ offset: nextIndex * width, animated: false });
    }
  }, [firstDay, interaction, position, revision, scrollOffset, selectedDate, width]);

  const updateInteraction = useCallback((nextPhase: number) => {
    runOnUI((value: number) => {
      'worklet';
      if (enabled.value || value === 0) interaction.value = value;
    })(nextPhase);
  }, [enabled, interaction]);

  const completeSettle = useCallback((offsetX: number, token: number, expectedRevision: number) => {
    const current = motion.current;
    if (!current.mounted || !latest.current.active || !latest.current.scrollEnabled ||
        current.generation !== token || current.revision !== expectedRevision ||
        latest.current.readRevision() !== expectedRevision) {
      return;
    }
    const index = Math.max(0, Math.min(PAGE_COUNT - 1, Math.round(offsetX / width)));
    current.index = index;
    current.phase = 'idle';
    updateInteraction(0);
    if (current.acknowledged === index) {
      position.value = firstDay + index;
      return;
    }
    const accepted = latest.current.onSettle(index, expectedRevision, surface);
    if (accepted === undefined) return;
    current.revision = accepted;
    current.expectedRevision = accepted;
    current.acknowledged = index;
    position.value = firstDay + index;
  }, [firstDay, position, surface, updateInteraction, width]);

  const dates = useMemo(() => Array.from({ length: PAGE_COUNT }, (_, i) => shiftDateId(baseDate, i - RADIUS)), [baseDate]);
  const getFixedItemSize = useCallback(() => width, [width]);
  const renderItem = useCallback(({ item }: { item: string }) => (
    <View
      collapsable={false}
      style={{ width, height: '100%' }}
      accessibilityElementsHidden={item !== selectedDate}
      importantForAccessibility={item === selectedDate ? 'auto' : 'no-hide-descendants'}
    >
      {renderDay(item)}
    </View>
  ), [renderDay, selectedDate, width]);

  return (
    <AnimatedLegendList
      ref={attach}
      style={styles.fill}
      horizontal
      pagingEnabled
      recycleItems
      maintainVisibleContentPosition={false}
      drawDistance={width}
      initialScrollIndex={RADIUS}
      getFixedItemSize={getFixedItemSize}
      scrollEnabled={scrollEnabled}
      showsHorizontalScrollIndicator={false}
      bounces={false}
      overScrollMode="never"
      sharedValues={{ scrollOffset }}
      data={dates}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onScrollBeginDrag={() => {
        const current = motion.current;
        if (!current.mounted || !latest.current.active || !latest.current.scrollEnabled ||
            latest.current.readRevision() !== current.revision) return;
        current.generation++;
        current.expectedRevision = current.revision;
        current.phase = 'dragging';
        updateInteraction(1);
      }}
      onScrollEndDrag={event => {
        const current = motion.current;
        if (!current.mounted || !latest.current.active || !latest.current.scrollEnabled) return;
        const velocityX = event?.nativeEvent?.velocity?.x ?? 0;
        const offsetX = event?.nativeEvent?.contentOffset?.x ?? current.index * width;
        if (Math.abs(velocityX) > 0) {
          current.phase = 'settling';
          updateInteraction(2);
        } else {
          completeSettle(offsetX, current.generation, current.expectedRevision);
        }
      }}
      onMomentumScrollEnd={event => {
        const current = motion.current;
        if (!current.mounted || !latest.current.active || !latest.current.scrollEnabled) return;
        if (current.phase === 'idle') {
          current.generation++;
          current.expectedRevision = current.revision;
        }
        const offsetX = event?.nativeEvent?.contentOffset?.x ?? current.index * width;
        completeSettle(offsetX, current.generation, current.expectedRevision);
      }}
    />
  );
});

const styles = StyleSheet.create({ fill: { flex: 1 } });
