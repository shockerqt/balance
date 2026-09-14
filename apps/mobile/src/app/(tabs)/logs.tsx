import React, { Profiler, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { logsDateStore, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, todayId } from '@/lib/dates';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { DateSwipe } from '@/components/meal/date-swipe';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { HourRailFeed } from '@/components/meal/hour-rail-feed';
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
        <DayLog selectedDateId={selectedDateId} />
      </Screen>
    </Profiler>
  );
}

// Keep the view mounted; selection and scroll are scoped explicitly to the date.
function DayLog({ selectedDateId }: { selectedDateId: string }) {
  const router = useRouter();
  const { dayLogs, deleteMultipleFoods } = useMealStore();
  const log = useMemo(() => dayLogs[selectedDateId] ?? emptyDayLog(selectedDateId), [dayLogs, selectedDateId]);
  const selection = useFoodSelection(selectedDateId);
  const revision = logsDateStore.getRevision();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate, syncError: weightSyncError } = useWeightStore();

  const openFoodSearchFor = useCallback(
    (dateId: string, time?: string) => {
      router.push({
        pathname: '/food-search',
        params: { dateId, time: time ?? currentTimeString() },
      });
    },
    [router]
  );

  const openEditFor = useCallback(
    (dateId: string, food: LoggedFoodItem) => {
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
    const ids = Array.from(selection.selectedIds);
    if (!ids.length) return;
    deleteMultipleFoods(selectedDateId, ids);
    selection.clear();
  }, [deleteMultipleFoods, selectedDateId, selection]);

  const openBatchMove = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    if (!ids.length) return;
    router.push({
      pathname: '/batch-move',
      params: { dateId: selectedDateId, ids: ids.join(',') },
    });
    selection.clear();
  }, [router, selectedDateId, selection]);

  const openWeightEntry = useCallback(() => {
    router.push({ pathname: '/weight-entry', params: { dateId: selectedDateId } });
  }, [router, selectedDateId]);

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
            dateId={selectedDateId}
            foods={log.foods}
            onSelectFood={(food) => {
              if (!selection.isSelectionMode) openEditFor(selectedDateId, food);
            }}
            onAddAtHour={(hour) => openFoodSearchFor(selectedDateId, hour)}
            isSelectionMode={selection.isSelectionMode}
            selectedFoodIds={selection.selectedIds}
            onLongPressFood={selection.startFromFood}
            onLongPressGroup={selection.startFromGroup}
            onToggleSelectFood={selection.toggleFood}
            onToggleSelectGroup={selection.toggleGroup}
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
}
