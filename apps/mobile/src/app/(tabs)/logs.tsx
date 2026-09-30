import React, { Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, shiftDateId, todayId } from '@/lib/dates';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { DateSwipe } from '@/components/meal/date-swipe';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { HourRailFeed, type HourRailFeedHandle } from '@/components/meal/hour-rail-feed';
import { BatchActionBar } from '@/components/meal/batch-action-bar';
import { FloatingAddButton } from '@/components/meal/floating-add-button';
import { Screen, Text } from '@/components/ui';
import { DailyWeightRow } from '@/components/weight/daily-weight-row';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { logRenderCallback } from '@/dev/log-performance';

export default function LogsScreen() {
  const [selectedDateId, setSelectedDateId] = useLogsSelectedDate();
  const { dayLogs } = useMealStore();
  const count = dayLogs[selectedDateId]?.foods.length ?? 0;
  const revision = logsDateStore.getRevision();
  const { width } = useWindowDimensions();
  const [centerDateId, setCenterDateId] = useState(selectedDateId);
  const translation = useSharedValue(0);
  const transitionId = useRef(0);
  const dates = useMemo(() => [shiftDateId(centerDateId, -1), centerDateId, shiftDateId(centerDateId, 1)], [centerDateId]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }));

  const finishTransition = useCallback((id: number, dateId: string) => {
    if (transitionId.current === id && logsDateStore.get() === dateId) setCenterDateId(dateId);
  }, []);

  useLayoutEffect(() => {
    const id = ++transitionId.current;
    cancelAnimation(translation);
    translation.value = 0;
    if (selectedDateId === centerDateId) {
      return;
    }
    const direction = selectedDateId === dates[2] ? 1 : selectedDateId === dates[0] ? -1 : 0;
    if (direction === 0) {
      setCenterDateId(selectedDateId);
      return;
    }
    translation.value = withTiming(-direction * width, {
      duration: 170,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    }, (finished) => {
      if (finished) runOnJS(finishTransition)(id, selectedDateId);
    });
  }, [centerDateId, dates, finishTransition, revision, selectedDateId, translation, width]);
  useEffect(() => () => {
    transitionId.current += 1;
    cancelAnimation(translation);
  }, [translation]);

  return (
    <Profiler id="screen" onRender={logRenderCallback('screen', revision, count)}>
      <Screen>
        <Profiler id="header" onRender={logRenderCallback('header', revision, count)}>
          <DateStripHeader
            selectedDateId={selectedDateId}
            onSelectDate={setSelectedDateId}
            onShiftDate={logsDateStore.shift}
          />
        </Profiler>
        <View style={styles.viewport}>
          <Animated.View style={[styles.track, { left: -width, width: width * 3 }, animatedStyle]}>
            {dates.map((dateId) => (
              <View key={dateId} pointerEvents={dateId === selectedDateId ? 'auto' : 'none'}
                style={{ width, flex: 1 }} accessibilityElementsHidden={dateId !== selectedDateId}
                importantForAccessibility={dateId === selectedDateId ? 'auto' : 'no-hide-descendants'}>
                <DayLog selectedDateId={dateId} />
              </View>
            ))}
          </Animated.View>
        </View>
      </Screen>
    </Profiler>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  track: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' },
});

// A bounded three-day window keeps adjacent native views ready. The date store
// remains authoritative; offscreen views cannot issue actions or gestures.
const DayLog = React.memo(function DayLog({ selectedDateId }: { selectedDateId: string }) {
  const router = useRouter();
  const { dayLogs, deleteMultipleFoods } = useMealStore();
  const log = useMemo(() => dayLogs[selectedDateId] ?? emptyDayLog(selectedDateId), [dayLogs, selectedDateId]);
  const selection = useFoodSelection(selectedDateId);
  const feed = useRef<HourRailFeedHandle>(null);
  // Reset a retained pane on arrival without re-rendering prepared food rows.
  useEffect(() => logsDateStore.subscribe(() => {
    if (logsDateStore.get() !== selectedDateId) selection.clear();
    else feed.current?.resetScroll();
  }), [selectedDateId, selection.clear]);
  const revision = logsDateStore.get() === selectedDateId ? logsDateStore.getRevision() : -1;
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate, syncError: weightSyncError } = useWeightStore();

  const openFoodSearchFor = useCallback(
    (dateId: string, time?: string) => {
      if (logsDateStore.get() !== dateId) return;
      router.push({
        pathname: '/food-search',
        params: { dateId, time: time ?? currentTimeString() },
      });
    },
    [router]
  );

  const openEditFor = useCallback(
    (dateId: string, food: LoggedFoodItem) => {
      if (logsDateStore.get() !== dateId) return;
      router.push({
        pathname: '/food-edit',
        params: { dateId, foodId: food.id },
      });
    },
    [router]
  );

  // El botón flotante siempre anota en el día confirmado.
  const openFoodSearch = useCallback(
    () => openFoodSearchFor(selectedDateId),
    [openFoodSearchFor, selectedDateId]
  );

  const batchDelete = useCallback(() => {
    if (logsDateStore.get() !== selectedDateId) return;
    const ids = Array.from(selection.selectedIds);
    if (!ids.length) return;
    deleteMultipleFoods(selectedDateId, ids);
    selection.clear();
  }, [deleteMultipleFoods, selectedDateId, selection]);

  const openBatchMove = useCallback(() => {
    if (logsDateStore.get() !== selectedDateId) return;
    const ids = Array.from(selection.selectedIds);
    if (!ids.length) return;
    router.push({
      pathname: '/batch-move',
      params: { dateId: selectedDateId, ids: ids.join(',') },
    });
    selection.clear();
  }, [router, selectedDateId, selection]);

  const openWeightEntry = useCallback(() => {
    if (logsDateStore.get() !== selectedDateId) return;
    router.push({ pathname: '/weight-entry', params: { dateId: selectedDateId } });
  }, [router, selectedDateId]);

  const onLongPressFood = useCallback((food: LoggedFoodItem) => {
    if (logsDateStore.get() === selectedDateId) selection.startFromFood(food);
  }, [selectedDateId, selection.startFromFood]);
  const onLongPressGroup = useCallback((ids: string[]) => {
    if (logsDateStore.get() === selectedDateId) selection.startFromGroup(ids);
  }, [selectedDateId, selection.startFromGroup]);
  const onToggleSelectFood = useCallback((id: string) => {
    if (logsDateStore.get() === selectedDateId) selection.toggleFood(id);
  }, [selectedDateId, selection.toggleFood]);
  const onToggleSelectGroup = useCallback((ids: string[]) => {
    if (logsDateStore.get() === selectedDateId) selection.toggleGroup(ids);
  }, [selectedDateId, selection.toggleGroup]);

  return (
    <>
      {preferencesReady && weightTrackingEnabled ? (
        <DailyWeightRow
          measurement={weightsByDate[selectedDateId]}
          disabled={selectedDateId > todayId()}
          onPress={openWeightEntry}
        />
      ) : null}
      {weightSyncError ? <Text tone="danger">{weightSyncError.message}</Text> : null}
      <Profiler id="summary" onRender={logRenderCallback('summary', revision, log.foods.length)}>
        <StickyMacroHeader
          foods={log.foods}
          targetCalories={log.targetCalories}
          targetProtein={log.targetProtein}
          targetCarbs={log.targetCarbs}
          targetFat={log.targetFat}
          targetFiber={log.targetFiber}
        />
      </Profiler>
      <Profiler id="feed" onRender={logRenderCallback('feed', revision, log.foods.length)}>
        <DateSwipe disabled={selection.isSelectionMode} style={{ flex: 1 }}>
          <HourRailFeed
            ref={feed}
            dateId={selectedDateId}
            foods={log.foods}
            onSelectFood={(food) => {
              if (!selection.isSelectionMode) openEditFor(selectedDateId, food);
            }}
            onAddAtHour={(hour) => openFoodSearchFor(selectedDateId, hour)}
            isSelectionMode={selection.isSelectionMode}
            selectedFoodIds={selection.selectedIds}
            onLongPressFood={onLongPressFood}
            onLongPressGroup={onLongPressGroup}
            onToggleSelectFood={onToggleSelectFood}
            onToggleSelectGroup={onToggleSelectGroup}
          />
        </DateSwipe>
      </Profiler>
      {selection.isSelectionMode ? (
        <BatchActionBar
          count={selection.selectedCount}
          onCancel={selection.clear}
          onMove={openBatchMove}
          onDelete={batchDelete}
        />
      ) : (
        <FloatingAddButton onPress={openFoodSearch} />
      )}
    </>
  );
});
