import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { buildDateWindow, currentTimeString } from '@/lib/dates';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { FluidTimelineFeed } from '@/components/meal/fluid-timeline-feed';
import { TimeFoodModal } from '@/components/meal/time-food-modal';
import { BatchMoveModal } from '@/components/meal/batch-move-modal';
import { BatchActionBar } from '@/components/meal/batch-action-bar';
import { FloatingAddButton } from '@/components/meal/floating-add-button';
import { Screen } from '@/components/ui';
import { makeStyles } from '@/theme';

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
    addFood,
    updateFood,
    deleteFood,
    deleteMultipleFoods,
    moveMultipleFoodsTime,
  } = useMealStore();

  const selection = useFoodSelection();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [foodToEdit, setFoodToEdit] = useState<LoggedFoodItem | null>(null);
  const [presetTime, setPresetTime] = useState('08:30');
  const [batchMoveVisible, setBatchMoveVisible] = useState(false);

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
      setFoodToEdit(food);
      setPresetTime(food.time);
      setEditModalVisible(true);
    },
    [selection.isSelectionMode]
  );

  const saveFood = useCallback(
    (data: Omit<LoggedFoodItem, 'id'>, foodId?: string) => {
      if (foodId) updateFood(currentDayLog.dateId, foodId, data);
      else addFood(currentDayLog.dateId, data);
    },
    [addFood, updateFood, currentDayLog.dateId]
  );

  const removeFood = useCallback(
    (foodId: string) => deleteFood(currentDayLog.dateId, foodId),
    [deleteFood, currentDayLog.dateId]
  );

  const batchDelete = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    if (!ids.length) return;
    deleteMultipleFoods(selectedDateId, ids);
    selection.clear();
  }, [deleteMultipleFoods, selectedDateId, selection]);

  const batchMove = useCallback(
    (newTime: string) => {
      const ids = Array.from(selection.selectedIds);
      if (!ids.length) return;
      moveMultipleFoodsTime(selectedDateId, ids, newTime);
      selection.clear();
    },
    [moveMultipleFoodsTime, selectedDateId, selection]
  );

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
                <FluidTimelineFeed
                  foods={log.foods}
                  onSelectFood={openEdit}
                  onAddAtTime={openFoodSearch}
                  onDeleteFood={removeFood}
                  isSelectionMode={selection.isSelectionMode}
                  selectedFoodIds={selection.selectedIds as Set<string>}
                  onLongPressFood={selection.startFromFood}
                  onLongPressGroup={(_timeKey, ids) => selection.startFromGroup(ids)}
                  onToggleSelectFood={selection.toggleFood}
                  onToggleSelectGroup={(_timeKey, ids) => selection.toggleGroup(ids)}
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
          onMove={() => setBatchMoveVisible(true)}
          onDelete={batchDelete}
        />
      ) : (
        <FloatingAddButton onPress={() => openFoodSearch()} />
      )}

      <TimeFoodModal
        visible={editModalVisible}
        initialTime={presetTime}
        foodToEdit={foodToEdit}
        onClose={() => setEditModalVisible(false)}
        onSave={saveFood}
        onDelete={removeFood}
      />

      <BatchMoveModal
        visible={batchMoveVisible}
        selectedCount={selection.selectedCount}
        onClose={() => setBatchMoveVisible(false)}
        onConfirmMove={batchMove}
      />
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  pager: { flex: 1 },
  page: { flex: 1 },
}));
