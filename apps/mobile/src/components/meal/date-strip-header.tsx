import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, useWindowDimensions } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Icon, PressScale } from '@/components/ui';
import {
  DAY_NAMES,
  DateItem,
  MONTH_NAMES,
  generateWeeksWindow,
  parseDateId,
  shiftDateId,
  todayId,
} from '@/lib/dates';

export type WeekStartDay = 'monday' | 'sunday';

/* Cuánto acompaña el bloque de título al dedo, en píxeles, y con qué fuerza se
   apaga al cruzar de día. El texto no se puede interpolar en el hilo de UI: lo
   que se interpola es su desplazamiento y su opacidad, y el contenido conmuta
   en el punto más apagado del recorrido. */
const TITLE_DRIFT = 26;
const TITLE_FADE = 1.5;

interface DateStripHeaderProps {
  /** Día confirmado. Es el que usan las flechas para no perder pulsaciones. */
  selectedDateId: string;
  /** Día que la cabecera pinta. Conmuta a mitad del gesto, no al final. */
  visualDateId: string;
  /** Día absoluto fraccionario del pager de registros. Vive en el hilo de UI. */
  dayProgress: SharedValue<number>;
  onSelectDate: (dateId: string) => void;
  weekStartsOn?: WeekStartDay;
}

/* La píldora se dibuja en dos capas apiladas —la normal abajo, la seleccionada
   completa encima— y lo único animado es la opacidad de la de arriba. Sale más
   barato que interpolar cinco colores por píldora, no reflúa el texto al
   cambiar de grosor, y el resaltado hace crossfade siguiendo al dedo. */
const DayPill: React.FC<{
  item: DateItem;
  dayProgress: SharedValue<number>;
  onSelectDate: (dateId: string) => void;
}> = React.memo(({ item, dayProgress, onSelectDate }) => {
  const theme = useTheme();
  const { epochDay } = item;

  const selectedLayerStyle = useAnimatedStyle(() => {
    const distance = Math.abs(dayProgress.value - epochDay);
    return { opacity: distance >= 1 ? 0 : 1 - distance };
  });

  const handlePress = useCallback(() => onSelectDate(item.dateId), [item.dateId, onSelectDate]);

  return (
    <PressScale
      style={[
        styles.dayPill,
        {
          backgroundColor: theme.colors.surface,
          borderColor: item.isToday ? theme.colors.primary : theme.colors.border,
        },
      ]}
      scaleTo={0.9}
      opacityTo={0.75}
      accessibilityLabel={`Ir al día ${item.dayNumber}`}
      onPress={handlePress}>
      <Text
        style={[
          styles.dayNameText,
          { color: item.isToday ? theme.colors.primary : theme.colors.textMuted },
        ]}>
        {item.dayName}
      </Text>

      <Text
        style={[
          styles.dayNumberText,
          { color: item.isToday ? theme.colors.primary : theme.colors.text },
        ]}>
        {item.dayNumber}
      </Text>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.selectedLayer,
          {
            backgroundColor: theme.colors.primary,
            borderColor: theme.colors.primary,
          },
          selectedLayerStyle,
        ]}>
        <Text
          style={[styles.dayNameText, styles.dayNameSelected, { color: theme.colors.onPrimary }]}>
          {item.dayName}
        </Text>
        <Text style={[styles.dayNumberText, { color: theme.colors.onPrimary }]}>
          {item.dayNumber}
        </Text>
      </Animated.View>
    </PressScale>
  );
});

export const DateStripHeader: React.FC<DateStripHeaderProps> = React.memo(({
  selectedDateId,
  visualDateId,
  dayProgress,
  onSelectDate,
}) => {
  const theme = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);

  /* Se recalcula en cada render, no se congela al montar: `todayId()` está
     memoizado por minuto, así que es barato y la app deja de mostrar el día
     anterior como "Hoy" si queda abierta cruzando la medianoche. */
  const todayDateId = todayId();

  /* Ventana compacta de 3 semanas (-1..+1). Se ancla en el día visible, no en
     el confirmado: así la banda cambia de semana en el mismo instante en que el
     resaltado llega al borde, a mitad del gesto. */
  const [anchorDateId, setAnchorDateId] = useState(visualDateId);
  const weeksList = useMemo(
    () => generateWeeksWindow(anchorDateId, 1, 1, todayDateId),
    [anchorDateId, todayDateId]
  );

  const activeWeekIndex = weeksList.findIndex((w) =>
    w.days.some((d) => d.dateId === visualDateId)
  );

  // Si el día visible se sale de la ventana de 3 semanas, re-anclamos al instante
  useEffect(() => {
    if (activeWeekIndex === -1) {
      setAnchorDateId(visualDateId);
    }
  }, [activeWeekIndex, visualDateId]);

  /* Guardas de sincronización para evitar bucles de retroalimentación.

     Las dos son pestillos, no lecturas del estado vivo: el pager emite
     `settling` *antes* de `onPageSelected`, así que preguntar en ese momento si
     el usuario "está arrastrando" siempre daba no, y el gesto sobre la banda de
     semanas quedaba descartado. `userInitiatedRef` se levanta al empezar el
     arrastre y lo consume `onPageSelected`, funcione el pager en un orden o en
     el otro.

     Del salto programático se guarda el índice destino, no un booleano: si el
     salto no llegara a emitir evento, un booleano se quedaría armado y se
     comería el siguiente gesto real del usuario. */
  const userInitiatedRef = useRef(false);
  const programmaticTargetRef = useRef<number | null>(null);
  const currentWeekIndexRef = useRef(activeWeekIndex !== -1 ? activeWeekIndex : 1);

  useEffect(() => {
    if (activeWeekIndex !== -1 && currentWeekIndexRef.current !== activeWeekIndex) {
      currentWeekIndexRef.current = activeWeekIndex;
      programmaticTargetRef.current = activeWeekIndex;
      pagerRef.current?.setPageWithoutAnimation(activeWeekIndex);
    }
  }, [activeWeekIndex, visualDateId]);

  const handlePageScrollStateChanged = useCallback(
    (e: { nativeEvent: { pageScrollState: 'idle' | 'dragging' | 'settling' } }) => {
      if (e.nativeEvent.pageScrollState === 'dragging') {
        userInitiatedRef.current = true;
      }
    },
    []
  );

  const handlePageSelected = useCallback(
    (e: PagerViewOnPageSelectedEvent) => {
      const pagePos = e.nativeEvent.position;
      currentWeekIndexRef.current = pagePos;

      /* Si el cambio fue programático (fecha externa o botón), ignorar. La
         guarda es de un solo uso: la consume el evento que calza y la borra
         cualquier otro, para no dejarla armada contra un gesto futuro. */
      const programmaticTarget = programmaticTargetRef.current;
      programmaticTargetRef.current = null;
      if (programmaticTarget === pagePos) {
        return;
      }

      // Solo reaccionar al gesto del usuario sobre la banda de semanas
      if (!userInitiatedRef.current) {
        return;
      }
      userInitiatedRef.current = false;

      const targetWeek = weeksList[pagePos];
      if (targetWeek) {
        const stillInWeek = targetWeek.days.some((d) => d.dateId === selectedDateId);
        if (!stillInWeek) {
          // Mantener el mismo día de la semana (Lunes=0..Domingo=6)
          const base = parseDateId(selectedDateId);
          const dayOfWeekIndex = (base.getUTCDay() + 6) % 7;
          const targetDay = targetWeek.days[dayOfWeekIndex] ?? targetWeek.days[0];
          if (targetDay) {
            onSelectDate(targetDay.dateId);
          }
        }
      }
    },
    [weeksList, selectedDateId, onSelectDate]
  );

  const handlePrevDay = useCallback(() => {
    onSelectDate(shiftDateId(selectedDateId, -1));
  }, [selectedDateId, onSelectDate]);

  const handleNextDay = useCallback(() => {
    onSelectDate(shiftDateId(selectedDateId, 1));
  }, [selectedDateId, onSelectDate]);

  const openDatePicker = useCallback(() => router.push('/date-picker'), [router]);
  const goToToday = useCallback(() => onSelectDate(todayDateId), [onSelectDate, todayDateId]);

  /* El bloque de título viaja con el dedo y se apaga en el cruce. El texto de
     abajo ya corresponde al día al que se va, porque `visualDateId` conmuta en
     la mitad del gesto: el cambio ocurre justo donde menos se ve. */
  const titleSwipeStyle = useAnimatedStyle(() => {
    const fraction = dayProgress.value - Math.round(dayProgress.value);
    return {
      opacity: Math.max(1 - Math.abs(fraction) * TITLE_FADE, 0.25),
      transform: [{ translateX: -fraction * TITLE_DRIFT }],
    };
  });

  const visualDateObj = parseDateId(visualDateId);
  const dayNameFull = DAY_NAMES[visualDateObj.getUTCDay()];
  const dayNum = visualDateObj.getUTCDate();
  const monthNameFull = MONTH_NAMES[visualDateObj.getUTCMonth()];
  const yearNum = visualDateObj.getUTCFullYear();
  const isVisualToday = visualDateId === todayDateId;

  const line1Text = isVisualToday ? 'Hoy' : `${dayNameFull} ${dayNum}`;
  const line2Text = isVisualToday
    ? `${dayNum} de ${monthNameFull}`
    : `${monthNameFull}, ${yearNum}`;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.background,
          borderBottomColor: theme.colors.border,
        },
      ]}>
      {/* 1. Header Row */}
      <View style={styles.topHeaderRow}>
        <View style={styles.fixedDateNavBox}>
          <PressScale
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            accessibilityLabel="Ir al día anterior"
            onPress={handlePrevDay}>
            <Icon name="chevron-left" size={20} tone="accent" />
          </PressScale>

          <Animated.View style={[styles.dateTitleBox, titleSwipeStyle]}>
            <PressScale
              style={styles.dateTitleTouch}
              scaleTo={0.97}
              accessibilityLabel="Elegir fecha"
              onPress={openDatePicker}>
              <Text
                numberOfLines={1}
                style={[styles.headlineTitle, { color: theme.colors.text }]}>
                {line1Text}
              </Text>
              <Text
                numberOfLines={1}
                style={[styles.subtitleContext, { color: theme.colors.textSecondary }]}>
                {line2Text}
              </Text>
            </PressScale>
          </Animated.View>

          <PressScale
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            accessibilityLabel="Ir al día siguiente"
            onPress={handleNextDay}>
            <Icon name="chevron-right" size={20} tone="accent" />
          </PressScale>
        </View>

        {!isVisualToday && (
          <PressScale
            style={[
              styles.todayPillBtn,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.primary,
              },
            ]}
            accessibilityLabel="Volver a hoy"
            onPress={goToToday}>
            <Text style={[styles.todayPillText, { color: theme.colors.primary }]}>
              Hoy
            </Text>
          </PressScale>
        )}
      </View>

      {/* 2. Week Strip Pager */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={activeWeekIndex !== -1 ? activeWeekIndex : 1}
        onPageScrollStateChanged={handlePageScrollStateChanged}
        onPageSelected={handlePageSelected}>
        {weeksList.map((week) => (
          <View key={week.weekIndex} style={[styles.weekPage, { width: windowWidth }]}>
            <View style={styles.daysRow}>
              {week.days.map((item) => (
                <DayPill
                  key={item.dateId}
                  item={item}
                  dayProgress={dayProgress}
                  onSelectDate={onSelectDate}
                />
              ))}
            </View>
          </View>
        ))}
      </PagerView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  topHeaderRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    position: 'relative',
    height: 48,
  },
  fixedDateNavBox: {
    width: 256,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navArrowBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Ocupa todo el espacio libre entre las flechas. Antes se ajustaba al texto y
     las flechas se movían al cambiar de día; ahora que el título conmuta a
     mitad del gesto, ese salto se vería en cada cruce. */
  dateTitleBox: {
    flex: 1,
  },
  dateTitleTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headlineTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitleContext: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 1,
  },
  todayPillBtn: {
    position: 'absolute',
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  todayPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  pagerView: {
    height: 58,
  },
  weekPage: {
    height: 58,
    justifyContent: 'center',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    gap: 4,
  },
  dayPill: {
    flex: 1,
    height: 54,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  /* Los -1 compensan el borde de la capa de abajo: así las dos cajas de
     contenido coinciden y el texto no se corre un píxel al aparecer. */
  selectedLayer: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  dayNameText: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayNameSelected: {
    fontWeight: '700',
  },
  dayNumberText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
