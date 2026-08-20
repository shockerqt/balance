import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { buildDateWindow, currentTimeString, todayId } from '@/lib/dates';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { HourRailFeed } from '@/components/meal/hour-rail-feed';
import { BatchActionBar } from '@/components/meal/batch-action-bar';
import { FloatingAddButton } from '@/components/meal/floating-add-button';
import { Screen, Text } from '@/components/ui';
import { makeStyles } from '@/theme';
import { DailyWeightRow } from '@/components/weight/daily-weight-row';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';

/* Registros del día. La pantalla compone: la ventana de fechas vive
   en lib/dates, la selección múltiple en use-food-selection, y la
   barra de lote y el botón flotante son componentes propios. */

/** Radio de precarga ágil: día activo y sus 2 vecinos inmediatos (ayer y mañana). */
const PRELOAD_RADIUS = 1;

interface DayPageProps {
  dateId: string;
  isNearby: boolean;
  foods: LoggedFoodItem[];
  openEdit: (food: LoggedFoodItem) => void;
  openFoodSearch: (hour?: string) => void;
  isSelectionMode: boolean;
  selectedFoodIds: ReadonlySet<string>;
  onLongPressFood: (food: LoggedFoodItem) => void;
  onLongPressGroup: (foodIds: string[]) => void;
  onToggleSelectFood: (foodId: string) => void;
  onToggleSelectGroup: (foodIds: string[]) => void;
}

const DayPage: React.FC<DayPageProps> = React.memo(({
  dateId,
  isNearby,
  foods,
  openEdit,
  openFoodSearch,
  isSelectionMode,
  selectedFoodIds,
  onLongPressFood,
  onLongPressGroup,
  onToggleSelectFood,
  onToggleSelectGroup,
}) => {
  const styles = useStyles();

  if (!isNearby) {
    return <View key={dateId} style={styles.page} />;
  }

  return (
    <View key={dateId} style={styles.page}>
      <HourRailFeed
        foods={foods}
        onSelectFood={openEdit}
        onAddAtHour={openFoodSearch}
        isSelectionMode={isSelectionMode}
        selectedFoodIds={selectedFoodIds}
        onLongPressFood={onLongPressFood}
        onLongPressGroup={onLongPressGroup}
        onToggleSelectFood={onToggleSelectFood}
        onToggleSelectGroup={onToggleSelectGroup}
      />
    </View>
  );
});

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
  const { weightsByDate, syncError: weightSyncError } = useWeightStore();

  // Ventana compacta de 3 semanas (1 antes, actual, 1 después = 21 días) centrada en el ancla.
  const [windowAnchor, setWindowAnchor] = useState(selectedDateId);
  const dateWindow = useMemo(() => buildDateWindow(windowAnchor, 1, 1), [windowAnchor]);

  const activeIndex = dateWindow.indexOf(selectedDateId);
  useEffect(() => {
    if (activeIndex === -1) {
      setWindowAnchor(selectedDateId);
    }
  }, [activeIndex, selectedDateId]);

  // Guardas de sincronización para evitar bucles entre el gesto del usuario y React state
  const isProgrammaticScrollRef = useRef(false);
  const currentFeedIndexRef = useRef(activeIndex !== -1 ? activeIndex : 0);

  useEffect(() => {
    selection.clear();
    if (activeIndex !== -1) {
      // Solo sincronizar programáticamente si la página difiere (ej. selección externa por botón o picker)
      if (currentFeedIndexRef.current !== activeIndex) {
        currentFeedIndexRef.current = activeIndex;
        isProgrammaticScrollRef.current = true;
        // Salto inmediato sin animación para evitar latencia perceptiva y colisiones nativas
        pagerRef.current?.setPageWithoutAnimation(activeIndex);
      }
    }
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
    router.push({
      pathname: '/batch-move',
      params: { dateId: selectedDateId, ids: ids.join(',') },
    });
    selection.clear();
  }, [router, selectedDateId, selection]);

  const onPageSelected = useCallback(
    (e: PagerViewOnPageSelectedEvent) => {
      const newIndex = e.nativeEvent.position;
      currentFeedIndexRef.current = newIndex;

      // Si el cambio fue ordenado programáticamente, descartar el evento para evitar rebotes
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false;
        return;
      }

      const target = dateWindow[newIndex];
      if (target && target !== selectedDateId) {
        setSelectedDateId(target);
      }
    },
    [dateWindow, selectedDateId, setSelectedDateId]
  );

  return (
    <Screen>
      <DateStripHeader
        selectedDateId={selectedDateId}
        onSelectDate={setSelectedDateId}
      />

      {preferencesReady && weightTrackingEnabled ? (
        <DailyWeightRow
          measurement={weightsByDate[selectedDateId]}
          disabled={selectedDateId > todayId()}
          onPress={() =>
            router.push({
              pathname: '/weight-entry',
              params: { dateId: selectedDateId },
            })
          }
        />
      ) : null}
      {weightSyncError ? <Text tone="danger">{weightSyncError.message}</Text> : null}

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
          const foods = dayLogs[dateId]?.foods ?? emptyDayLog(dateId).foods;

          return (
            <DayPage
              key={dateId}
              dateId={dateId}
              isNearby={isNearby}
              foods={foods}
              openEdit={openEdit}
              openFoodSearch={openFoodSearch}
              isSelectionMode={selection.isSelectionMode}
              selectedFoodIds={selection.selectedIds}
              onLongPressFood={selection.startFromFood}
              onLongPressGroup={selection.startFromGroup}
              onToggleSelectFood={selection.toggleFood}
              onToggleSelectGroup={selection.toggleGroup}
            />
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
