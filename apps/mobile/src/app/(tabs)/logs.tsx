import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { useLogsSelectedDate } from '@/hooks/use-logs-date';
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

/* Radio de páginas montadas alrededor de la activa. Deslizar a un día vecino
   no monta nada, así que se siente instantáneo; un salto más largo monta una
   sola página. Subirlo no abarata el cambio de día —entre y salga una página
   del radio, el costo incremental es el mismo— y sí deja más vistas nativas
   residentes. */
const PRELOAD_RADIUS = 2;

/* Un día sin registros comparte este arreglo. Antes se llamaba a
   `emptyDayLog(dateId)` dentro del map del pager: devolvía un arreglo nuevo por
   día y por render, así que `React.memo` no reconocía ninguna página y las 21
   se volvían a renderizar en cada toque. */
const EMPTY_FOODS: LoggedFoodItem[] = [];

interface DayPageProps {
  dateId: string;
  isNearby: boolean;
  foods: LoggedFoodItem[];
  /* Reciben el dateId como argumento en vez de capturarlo: así las funciones
     que llegan desde la pantalla no cambian de identidad al cambiar de día. */
  onOpenEdit: (dateId: string, food: LoggedFoodItem) => void;
  onAddAtHour: (dateId: string, hour?: string) => void;
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
  onOpenEdit,
  onAddAtHour,
  isSelectionMode,
  selectedFoodIds,
  onLongPressFood,
  onLongPressGroup,
  onToggleSelectFood,
  onToggleSelectGroup,
}) => {
  const styles = useStyles();

  const handleSelectFood = useCallback(
    (food: LoggedFoodItem) => {
      if (isSelectionMode) return;
      onOpenEdit(dateId, food);
    },
    [dateId, isSelectionMode, onOpenEdit]
  );

  const handleAddAtHour = useCallback(
    (hour: string) => onAddAtHour(dateId, hour),
    [dateId, onAddAtHour]
  );

  if (!isNearby) {
    return <View key={dateId} style={styles.page} />;
  }

  return (
    <View key={dateId} style={styles.page}>
      <HourRailFeed
        foods={foods}
        onSelectFood={handleSelectFood}
        onAddAtHour={handleAddAtHour}
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

  const [selectedDateId, setSelectedDateId] = useLogsSelectedDate();
  const { dayLogs, deleteMultipleFoods } = useMealStore();

  const currentDayLog = useMemo(
    () => dayLogs[selectedDateId] ?? emptyDayLog(selectedDateId),
    [dayLogs, selectedDateId]
  );

  const selection = useFoodSelection();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate, syncError: weightSyncError } = useWeightStore();

  /* Ventana de 5 semanas (2 antes, actual, 2 después = 35 días) centrada en el
     ancla. Las páginas fuera del radio de precarga son un View vacío, así que
     ensanchar la ventana casi no cuesta y en cambio vuelve raro el re-anclaje,
     que sí es caro: reconstruye la lista completa de páginas. */
  const [windowAnchor, setWindowAnchor] = useState(selectedDateId);
  const dateWindow = useMemo(() => buildDateWindow(windowAnchor, 2, 2), [windowAnchor]);

  const activeIndex = dateWindow.indexOf(selectedDateId);
  useEffect(() => {
    if (activeIndex === -1) {
      setWindowAnchor(selectedDateId);
    }
  }, [activeIndex, selectedDateId]);

  /* Guarda de sincronización entre el gesto del usuario y el estado de React.
     Se guarda el índice destino del salto programático, no un booleano: así, si
     el salto no llega a emitir evento, no queda una guarda armada que se coma
     el siguiente gesto real. */
  const programmaticTargetRef = useRef<number | null>(null);
  const currentFeedIndexRef = useRef(activeIndex !== -1 ? activeIndex : 0);

  // Cambio de fecha sincrónico e instantáneo para botones de cabecera y picker
  const handleSelectDate = useCallback(
    (targetDateId: string) => {
      const targetIndex = dateWindow.indexOf(targetDateId);
      if (targetIndex !== -1 && currentFeedIndexRef.current !== targetIndex) {
        currentFeedIndexRef.current = targetIndex;
        programmaticTargetRef.current = targetIndex;
        // Salto nativo inmediato sin esperar el ciclo de renderizado de React
        pagerRef.current?.setPageWithoutAnimation(targetIndex);
      }
      setSelectedDateId(targetDateId);
    },
    [dateWindow, setSelectedDateId]
  );

  useEffect(() => {
    selection.clear();
    if (activeIndex !== -1) {
      if (currentFeedIndexRef.current !== activeIndex) {
        currentFeedIndexRef.current = activeIndex;
        programmaticTargetRef.current = activeIndex;
        pagerRef.current?.setPageWithoutAnimation(activeIndex);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateId, activeIndex]);

  /* Estas dos reciben el dateId y no lo capturan, así que sobreviven al cambio
     de día sin cambiar de identidad y las páginas memoizadas no se invalidan. */
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

  // El botón flotante siempre anota en el día visible.
  const openFoodSearchToday = useCallback(
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

  const onPageSelected = useCallback(
    (e: PagerViewOnPageSelectedEvent) => {
      const newIndex = e.nativeEvent.position;
      currentFeedIndexRef.current = newIndex;

      // Si el cambio fue ordenado programáticamente, descartar el evento para evitar rebotes
      if (programmaticTargetRef.current === newIndex) {
        programmaticTargetRef.current = null;
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
        onSelectDate={handleSelectDate}
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
          const foods = dayLogs[dateId]?.foods ?? EMPTY_FOODS;

          return (
            <DayPage
              key={dateId}
              dateId={dateId}
              isNearby={isNearby}
              foods={foods}
              onOpenEdit={openEditFor}
              onAddAtHour={openFoodSearchFor}
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
        <FloatingAddButton onPress={openFoodSearchToday} />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  pager: { flex: 1 },
  page: { flex: 1 },
}));
