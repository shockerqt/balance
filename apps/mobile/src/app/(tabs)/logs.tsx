import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { buildDateWindow, currentTimeString } from '@/lib/dates';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { HourRailFeed } from '@/components/meal/hour-rail-feed';
import { BatchActionBar } from '@/components/meal/batch-action-bar';
import { FloatingAddButton } from '@/components/meal/floating-add-button';
import { Screen } from '@/components/ui';
import { makeStyles } from '@/theme';
import { DailyWeightRow } from '@/components/weight/daily-weight-row';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { todayId } from '@/hooks/use-meal-store';

/* Registros del dia. La pantalla compone: la ventana de fechas vive
   en lib/dates, la seleccion multiple en use-food-selection, y la
   barra de lote y el boton flotante son componentes propios. */

/** Solo se montan los dias vecinos al activo: el resto son paginas vacias. */
const PRELOAD_RADIUS = 2;

export default function LogsScreen() {
  const styles = useStyles();
  const router = useRouter();
  const pagerRef = useRef<PagerView>(null);

  const {
    selectedDateId,
    setSelectedDateId,
    currentDayLog,
    dayLogs,
    deleteMultipleFoods,
  } = useMealStore();

  const selection = useFoodSelection();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate } = useWeightStore();

  // La ventana se reconstruye solo cuando el dia sale de ella.
  const [windowAnchor, setWindowAnchor] = useState(selectedDateId);
  const dateWindow = useMemo(() => buildDateWindow(windowAnchor), [windowAnchor]);

  const activeIndex = dateWindow.indexOf(selectedDateId);
  useEffect(() => {
    if (activeIndex === -1) setWindowAnchor(selectedDateId);
  }, [activeIndex, selectedDateId]);

  useEffect(() => {
    selection.clear();
    if (activeIndex !== -1) pagerRef.current?.setPage(activeIndex);
    // `selection` cambia de identidad al seleccionar; solo interesa el dia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateId, activeIndex]);

  const openFoodSearch = useCallback(
    (time?: string) => {
      router.push({
        pathname: '/food-search',
        params: { dateId: selectedDateId, time: time ?? currentTimeString() },
      });
    },
    [router, selectedDateId]
  );

  const openEdit = useCallback(
    (food: LoggedFoodItem) => {
      if (selection.isSelectionMode) return;
      router.push({
        pathname: '/food-edit',
        params: { dateId: selectedDateId, foodId: food.id },
      });
    },
    [router, selectedDateId, selection.isSelectionMode]
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
    router.push({ pathname: '/batch-move', params: { dateId: selectedDateId, ids: ids.join(',') } });
    selection.clear();
  }, [router, selectedDateId, selection]);

  const onPageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const target = dateWindow[e.nativeEvent.position];
    if (target && target !== selectedDateId) setSelectedDateId(target);
  };

  return (
    <Screen>
      <DateStripHeader
        selectedDateId={selectedDateId}
        onSelectDate={(dateId) => {
          setSelectedDateId(dateId);
          const index = dateWindow.indexOf(dateId);
          if (index !== -1) pagerRef.current?.setPage(index);
        }}
      />

      {preferencesReady && weightTrackingEnabled ? (
        <DailyWeightRow
          measurement={weightsByDate[selectedDateId]}
          disabled={selectedDateId > todayId()}
          onPress={() =>
            router.push({ pathname: '/weight-entry', params: { dateId: selectedDateId } })
          }
        />
      ) : null}

      <StickyMacroHeader
        foods={currentDayLog.foods}
        targetCalories={currentDayLog.targetCalories}
        targetProtein={currentDayLog.targetProtein}
        targetCarbs={currentDayLog.targetCarbs}
        targetFat={currentDayLog.targetFat}
        targetFiber={currentDayLog.targetFiber}
      />

      <PagerView
        ref={pagerRef}
        style={styles.pager}
        scrollEnabled={!selection.isSelectionMode}
        initialPage={activeIndex !== -1 ? activeIndex : 0}
        onPageSelected={onPageSelected}>
        {dateWindow.map((dateId, index) => {
          const isNearby = Math.abs(index - activeIndex) <= PRELOAD_RADIUS;
          const log = dayLogs[dateId] ?? emptyDayLog(dateId);

          return (
            <View key={dateId} style={styles.page}>
              {isNearby ? (
                <HourRailFeed
                  foods={log.foods}
                  onSelectFood={openEdit}
                  onAddAtHour={openFoodSearch}
                  isSelectionMode={selection.isSelectionMode}
                  selectedFoodIds={selection.selectedIds}
                  onLongPressFood={selection.startFromFood}
                  onLongPressGroup={selection.startFromGroup}
                  onToggleSelectFood={selection.toggleFood}
                  onToggleSelectGroup={selection.toggleGroup}
                />
              ) : null}
            </View>
          );
        })}
      </PagerView>

      {selection.isSelectionMode ? (
        <BatchActionBar
          count={selection.selectedCount}
          onCancel={selection.clear}
          onMove={openBatchMove}
          onDelete={batchDelete}
        />
      ) : (
        <FloatingAddButton onPress={() => openFoodSearch()} />
      )}


    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  pager: { flex: 1 },
  page: { flex: 1 },
}));
