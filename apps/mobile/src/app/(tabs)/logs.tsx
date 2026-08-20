import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import PagerView, {
  PagerViewOnPageScrollEvent,
  PagerViewOnPageScrollEventData,
  PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import Animated, {
  SharedValue,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useEvent,
  useHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { LoggedFoodItem, emptyDayLog, useMealStore } from '@/hooks/use-meal-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { useLogsSelectedDate } from '@/hooks/use-logs-date';
import {
  buildDateWindow,
  currentTimeString,
  dateIdToEpochDay,
  epochDayToDateId,
  todayId,
} from '@/lib/dates';
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
   barra de lote y el botón flotante son componentes propios.

   Hay dos nociones de "día actual", y son distintas a propósito:

   - `selectedDateId` es el día confirmado. Manda en lo que se escribe, se borra
     y se mueve, y sólo cambia cuando la página ya está decidida.
   - `visualDateId` es el día que la cabecera y el resumen pintan. Conmuta a
     mitad del gesto, donde el ojo espera el cambio.

   Antes había una sola, atada a `onPageSelected`, que el pager nativo emite
   cuando la página terminó de asentarse: de ahí que la cabecera y el resumen
   llegaran siempre un beat tarde. */

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

/* Radio de páginas montadas alrededor de la activa. Deslizar a un día vecino
   no monta nada, así que se siente instantáneo; un salto más largo monta una
   sola página. Subirlo no abarata el cambio de día —entre y salga una página
   del radio, el costo incremental es el mismo— y sí deja más vistas nativas
   residentes. */
const PRELOAD_RADIUS = 2;

/* Un día de distancia se desliza; más de uno se teletransporta. La animación
   nativa recorre las páginas intermedias, así que llegar a un día de otro mes
   sería un borrón de medio segundo donde lo único que importa es el destino. */
const ANIMATED_JUMP_MAX_DISTANCE = 1;

/* Cuánto acompaña el resumen al dedo y con qué fuerza se apaga en el cruce. Se
   mueve sólo el contenido, no la superficie: desplazar la tarjeta entera
   dejaría ver el fondo por el canto. */
const SUMMARY_DRIFT = 20;
const SUMMARY_FADE = 1.3;

/* Un día sin registros comparte este arreglo. Antes se llamaba a
   `emptyDayLog(dateId)` dentro del map del pager: devolvía un arreglo nuevo por
   día y por render, así que `React.memo` no reconocía ninguna página y las 21
   se volvían a renderizar en cada toque. */
const EMPTY_FOODS: LoggedFoodItem[] = [];

/**
 * Publica el progreso del pager como día absoluto fraccionario en un valor
 * compartido.
 *
 * `onPageScroll` es el único evento que reporta el avance del gesto, y llega
 * sesenta veces por segundo: atenderlo en JS es exactamente la tara que se
 * quiere evitar. Este handler corre en el hilo de UI, así que la cabecera puede
 * seguir el dedo sin pasar por un render de React.
 *
 * La unidad es el día absoluto y no el índice de página a propósito: el índice
 * pierde sentido cada vez que la ventana se re-ancla, el día no.
 */
function usePagerDayProgress(dayProgress: SharedValue<number>, windowStartEpochDay: number) {
  const handlers = {
    onPageScroll: (event: PagerViewOnPageScrollEventData) => {
      'worklet';
      dayProgress.value = windowStartEpochDay + event.position + event.offset;
    },
  };
  const { doDependenciesDiffer } = useHandler(handlers, [windowStartEpochDay]);

  const handler = useEvent<PagerViewOnPageScrollEventData>(
    (event) => {
      'worklet';
      if (event.eventName.endsWith('onPageScroll')) {
        handlers.onPageScroll(event);
      }
    },
    ['onPageScroll'],
    doDependenciesDiffer
  );

  return handler as unknown as (event: PagerViewOnPageScrollEvent) => void;
}

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

  const selection = useFoodSelection();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate, syncError: weightSyncError } = useWeightStore();

  /* Ventana de 5 semanas (2 antes, actual, 2 después = 35 días) centrada en el
     ancla. Las páginas fuera del radio de precarga son un View vacío, así que
     ensanchar la ventana casi no cuesta y en cambio vuelve raro el re-anclaje,
     que sí es caro: reconstruye la lista completa de páginas. */
  const [windowAnchor, setWindowAnchor] = useState(selectedDateId);
  const dateWindow = useMemo(() => buildDateWindow(windowAnchor, 2, 2), [windowAnchor]);
  const windowStartEpochDay = useMemo(
    () => dateIdToEpochDay(dateWindow[0] ?? windowAnchor),
    [dateWindow, windowAnchor]
  );

  const activeIndex = dateWindow.indexOf(selectedDateId);

  /* Guardas de sincronización entre el pager nativo y el estado de React.

     `currentFeedIndexRef` es la página que el pager tiene de verdad, y -1
     significa "desconocida". Se inicializa con la página real de montaje: si
     dijera 0 cuando el pager arranca en otra, el efecto de más abajo armaría en
     el montaje una guarda que después se comería un gesto legítimo.

     De la guarda programática se guarda el índice destino y no un booleano: si
     el salto no llegara a emitir evento, un booleano se quedaría armado y se
     comería el siguiente gesto real del usuario. */
  const programmaticTargetRef = useRef<number | null>(null);
  const currentFeedIndexRef = useRef(activeIndex !== -1 ? activeIndex : 0);

  useEffect(() => {
    if (activeIndex === -1) {
      setWindowAnchor(selectedDateId);
      /* Un índice de la ventana vieja no significa nada en la nueva, y si por
         coincidencia calzara con el índice del día pedido —de un domingo a otro
         domingo, digamos— el salto de más abajo se daría por hecho y el pager se
         quedaría mostrando otro día. */
      currentFeedIndexRef.current = -1;
    }
  }, [activeIndex, selectedDateId]);

  /* Progreso del pager en días absolutos, con decimales durante el gesto. Es el
     único origen de verdad de todo lo que se anima: cabecera, píldoras y
     resumen leen de aquí, en el hilo de UI. */
  const dayProgress = useSharedValue(dateIdToEpochDay(selectedDateId));
  const onPageScroll = usePagerDayProgress(dayProgress, windowStartEpochDay);

  const [visualDateId, setVisualDateId] = useState(selectedDateId);
  const visualDayLog = useMemo(
    () => dayLogs[visualDateId] ?? emptyDayLog(visualDateId),
    [dayLogs, visualDateId]
  );

  /* El día visible conmuta al cruzar la mitad del recorrido, no al soltar. Es
     el único punto donde el progreso continuo se convierte en estado de React,
     y por eso el resto del gesto no cuesta ningún render. */
  const commitVisualDay = useCallback((epochDay: number) => {
    setVisualDateId(epochDayToDateId(epochDay));
  }, []);

  useAnimatedReaction(
    () => Math.round(dayProgress.value),
    (epochDay, previous) => {
      'worklet';
      if (previous !== null && epochDay !== previous) {
        runOnJS(commitVisualDay)(epochDay);
      }
    },
    [commitVisualDay]
  );

  /* Salta al día pedido por la cabecera, las píldoras o el selector de fecha.
     Un día de distancia se desliza —y la cabecera viaja con la página, porque
     el pager emite `onPageScroll` durante toda la animación—; más lejos se
     teletransporta, y entonces hay que mover a mano el progreso y el día
     visible, en el mismo frame del toque, porque no habrá eventos intermedios
     que los muevan. */
  const handleSelectDate = useCallback(
    (targetDateId: string) => {
      const targetIndex = dateWindow.indexOf(targetDateId);

      if (targetIndex === -1) {
        // Fuera de la ventana: el re-anclaje reconstruye las páginas y salta.
        dayProgress.value = dateIdToEpochDay(targetDateId);
        setVisualDateId(targetDateId);
      } else if (currentFeedIndexRef.current !== targetIndex) {
        const distance = Math.abs(targetIndex - currentFeedIndexRef.current);
        currentFeedIndexRef.current = targetIndex;
        programmaticTargetRef.current = targetIndex;

        if (distance <= ANIMATED_JUMP_MAX_DISTANCE) {
          pagerRef.current?.setPage(targetIndex);
        } else {
          pagerRef.current?.setPageWithoutAnimation(targetIndex);
          dayProgress.value = dateIdToEpochDay(targetDateId);
          setVisualDateId(targetDateId);
        }
      }

      setSelectedDateId(targetDateId);
    },
    [dateWindow, dayProgress, setSelectedDateId]
  );

  /* Cambios de fecha que no pasaron por `handleSelectDate`: el selector de
     fecha, mover en lote, volver de otra pantalla. Aquí el salto siempre es
     instantáneo porque no hay gesto que acompañar. */
  useEffect(() => {
    selection.clear();
    if (activeIndex === -1 || currentFeedIndexRef.current === activeIndex) return;
    currentFeedIndexRef.current = activeIndex;
    programmaticTargetRef.current = activeIndex;
    pagerRef.current?.setPageWithoutAnimation(activeIndex);
    dayProgress.value = dateIdToEpochDay(selectedDateId);
    setVisualDateId(selectedDateId);
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

  // El botón flotante siempre anota en el día confirmado.
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

  const openWeightEntry = useCallback(() => {
    router.push({ pathname: '/weight-entry', params: { dateId: visualDateId } });
  }, [router, visualDateId]);

  const onPageSelected = useCallback(
    (e: PagerViewOnPageSelectedEvent) => {
      const newIndex = e.nativeEvent.position;
      currentFeedIndexRef.current = newIndex;

      /* Si el cambio fue ordenado programáticamente, descartar el evento para
         evitar rebotes. La guarda es de un solo uso en los dos sentidos: la
         consume el evento que calza, y también la borra cualquier otro, porque
         un evento distinto ya la dejó obsoleta y una guarda vieja se come un
         gesto real más tarde. */
      const programmaticTarget = programmaticTargetRef.current;
      programmaticTargetRef.current = null;
      if (programmaticTarget === newIndex) {
        return;
      }

      const target = dateWindow[newIndex];
      if (target && target !== selectedDateId) {
        setSelectedDateId(target);
      }
    },
    [dateWindow, selectedDateId, setSelectedDateId]
  );

  const summarySwipeStyle = useAnimatedStyle(() => {
    const fraction = dayProgress.value - Math.round(dayProgress.value);
    return {
      opacity: Math.max(1 - Math.abs(fraction) * SUMMARY_FADE, 0.35),
      transform: [{ translateX: -fraction * SUMMARY_DRIFT }],
    };
  });

  return (
    <Screen>
      <DateStripHeader
        selectedDateId={selectedDateId}
        visualDateId={visualDateId}
        dayProgress={dayProgress}
        onSelectDate={handleSelectDate}
      />

      {preferencesReady && weightTrackingEnabled ? (
        <DailyWeightRow
          measurement={weightsByDate[visualDateId]}
          disabled={visualDateId > todayId()}
          onPress={openWeightEntry}
        />
      ) : null}
      {weightSyncError ? <Text tone="danger">{weightSyncError.message}</Text> : null}

      <StickyMacroHeader
        foods={visualDayLog.foods}
        targetCalories={visualDayLog.targetCalories}
        targetProtein={visualDayLog.targetProtein}
        targetCarbs={visualDayLog.targetCarbs}
        targetFat={visualDayLog.targetFat}
        targetFiber={visualDayLog.targetFiber}
        contentStyle={summarySwipeStyle}
      />

      <AnimatedPagerView
        ref={pagerRef}
        style={styles.pager}
        scrollEnabled={!selection.isSelectionMode}
        initialPage={activeIndex !== -1 ? activeIndex : 0}
        onPageScroll={onPageScroll}
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
      </AnimatedPagerView>

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
