import React, { useRef, useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Icon } from '@/components/ui';
import {
  DAY_NAMES,
  MONTH_NAMES,
  generateWeeksWindow,
  parseDateId,
  shiftDateId,
  todayId,
} from '@/lib/dates';

export type WeekStartDay = 'monday' | 'sunday';

interface DateStripHeaderProps {
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  weekStartsOn?: WeekStartDay;
}

export const DateStripHeader: React.FC<DateStripHeaderProps> = ({
  selectedDateId,
  onSelectDate,
}) => {
  const theme = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);

  const todayDateId = useRef<string>(todayId()).current;

  // Ancla para generar ventana deslizante de 5 semanas (-2..+2)
  const [anchorDateId, setAnchorDateId] = useState(selectedDateId);
  const weeksList = useMemo(
    () => generateWeeksWindow(anchorDateId, 2, 2, todayDateId),
    [anchorDateId, todayDateId]
  );

  const activeWeekIndex = weeksList.findIndex((w) =>
    w.days.some((d) => d.dateId === selectedDateId)
  );

  // Si la fecha seleccionada se sale de la ventana de 5 semanas, re-anclamos
  useEffect(() => {
    if (activeWeekIndex === -1) {
      setAnchorDateId(selectedDateId);
    }
  }, [activeWeekIndex, selectedDateId]);

  // Guardas de sincronización para evitar bucles de retroalimentación
  const isUserDraggingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const currentWeekIndexRef = useRef(activeWeekIndex !== -1 ? activeWeekIndex : 2);

  useEffect(() => {
    if (activeWeekIndex !== -1 && currentWeekIndexRef.current !== activeWeekIndex) {
      currentWeekIndexRef.current = activeWeekIndex;
      isProgrammaticScrollRef.current = true;
      pagerRef.current?.setPageWithoutAnimation(activeWeekIndex);
    }
  }, [activeWeekIndex, selectedDateId]);

  const handlePageScrollStateChanged = (e: {
    nativeEvent: { pageScrollState: 'idle' | 'dragging' | 'settling' };
  }) => {
    // Solo es interacción manual si el usuario está físicamente arrastrando la pantalla (dragging)
    isUserDraggingRef.current = e.nativeEvent.pageScrollState === 'dragging';
  };

  const handlePageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const pagePos = e.nativeEvent.position;
    currentWeekIndexRef.current = pagePos;

    // Si el cambio fue programático (por cambio externo de fecha o botón), ignorar
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }

    // Solo reaccionar si el usuario arrastró físicamente con su dedo el pager de semanas
    if (!isUserDraggingRef.current) {
      return;
    }

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
  };

  const handlePrevDay = () => {
    onSelectDate(shiftDateId(selectedDateId, -1));
  };

  const handleNextDay = () => {
    onSelectDate(shiftDateId(selectedDateId, 1));
  };

  const selDateObj = parseDateId(selectedDateId);
  const dayNameFull = DAY_NAMES[selDateObj.getUTCDay()];
  const dayNum = selDateObj.getUTCDate();
  const monthNameFull = MONTH_NAMES[selDateObj.getUTCMonth()];
  const yearNum = selDateObj.getUTCFullYear();
  const isSelectedToday = selectedDateId === todayDateId;

  const line1Text = isSelectedToday ? 'Hoy' : `${dayNameFull} ${dayNum}`;
  const line2Text = isSelectedToday
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
          <TouchableOpacity
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            delayPressIn={0}
            accessibilityRole="button"
            accessibilityLabel="Ir al día anterior"
            onPress={handlePrevDay}>
            <Icon name="chevron-left" size={20} tone="accent" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dateTitleBox}
            delayPressIn={0}
            activeOpacity={0.7}
            onPress={() => router.push('/date-picker')}>
            <Text style={[styles.headlineTitle, { color: theme.colors.text }]}>
              {line1Text}
            </Text>
            <Text style={[styles.subtitleContext, { color: theme.colors.textSecondary }]}>
              {line2Text}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navArrowBtn, { backgroundColor: theme.colors.surface }]}
            delayPressIn={0}
            accessibilityRole="button"
            accessibilityLabel="Ir al día siguiente"
            onPress={handleNextDay}>
            <Icon name="chevron-right" size={20} tone="accent" />
          </TouchableOpacity>
        </View>

        {!isSelectedToday && (
          <TouchableOpacity
            style={[
              styles.todayPillBtn,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.primary,
              },
            ]}
            delayPressIn={0}
            onPress={() => onSelectDate(todayDateId)}>
            <Text style={[styles.todayPillText, { color: theme.colors.primary }]}>
              Hoy
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2. Week Strip Pager */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={activeWeekIndex !== -1 ? activeWeekIndex : 2}
        onPageScrollStateChanged={handlePageScrollStateChanged}
        onPageSelected={handlePageSelected}>
        {weeksList.map((week) => (
          <View key={week.weekIndex} style={[styles.weekPage, { width: windowWidth }]}>
            <View style={styles.daysRow}>
              {week.days.map((item) => {
                const isSelected = item.dateId === selectedDateId;

                return (
                  <TouchableOpacity
                    key={item.dateId}
                    style={[
                      styles.dayPill,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.border,
                      },
                      isSelected && {
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      },
                      item.isToday &&
                        !isSelected && {
                          borderColor: theme.colors.primary,
                        },
                    ]}
                    delayPressIn={0}
                    activeOpacity={0.7}
                    onPress={() => onSelectDate(item.dateId)}>
                    <Text
                      style={[
                        styles.dayNameText,
                        { color: theme.colors.textMuted },
                        isSelected && {
                          color: theme.colors.onPrimary,
                          fontWeight: '700',
                        },
                        item.isToday &&
                          !isSelected && {
                            color: theme.colors.primary,
                          },
                      ]}>
                      {item.dayName}
                    </Text>

                    <Text
                      style={[
                        styles.dayNumberText,
                        { color: theme.colors.text },
                        isSelected && { color: theme.colors.onPrimary },
                        item.isToday &&
                          !isSelected && {
                            color: theme.colors.primary,
                          },
                      ]}>
                      {item.dayNumber}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </PagerView>
    </View>
  );
};

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
  dateTitleBox: {
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
  dayNameText: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayNumberText: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
