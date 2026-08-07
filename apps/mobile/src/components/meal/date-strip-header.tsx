import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { Icon } from '@/components/ui';

export type WeekStartDay = 'monday' | 'sunday';

interface DateItem {
  dateId: string;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
}

interface WeekGroup {
  weekIndex: number;
  startDateId: string;
  days: DateItem[];
}

interface DateStripHeaderProps {
  selectedDateId: string;
  onSelectDate: (dateId: string) => void;
  weekStartsOn?: WeekStartDay;
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DAY_NAMES_FULL_ES = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];

const parseDateId = (dateId: string): Date => {
  const parts = dateId.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  return new Date();
};

const formatDateId = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const DateStripHeader: React.FC<DateStripHeaderProps> = ({
  selectedDateId,
  onSelectDate,
  weekStartsOn = 'monday',
}) => {
  const theme = useTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);

  const todayDateId = useRef<string>(formatDateId(new Date())).current;

  const buildWeekDays = (baseDate: Date): DateItem[] => {
    const dayOfWeek = baseDate.getDay();
    let startOffset = 0;
    if (weekStartsOn === 'monday') {
      startOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    } else {
      startOffset = -dayOfWeek;
    }

    const startOfWeek = new Date(baseDate);
    startOfWeek.setDate(baseDate.getDate() + startOffset);

    const labelsMon = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    const labelsSun = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
    const labels = weekStartsOn === 'monday' ? labelsMon : labelsSun;

    const days: DateItem[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);

      const dId = formatDateId(d);
      days.push({
        dateId: dId,
        dayName: labels[i],
        dayNumber: d.getDate(),
        isToday: dId === todayDateId,
      });
    }
    return days;
  };

  const generateFiveWeeks = (centerDateId: string): WeekGroup[] => {
    const centerDate = parseDateId(centerDateId);
    const weeks: WeekGroup[] = [];

    for (let offset = -2; offset <= 2; offset++) {
      const wDate = new Date(centerDate);
      wDate.setDate(centerDate.getDate() + offset * 7);

      const days = buildWeekDays(wDate);
      weeks.push({
        weekIndex: offset + 2,
        startDateId: days[0].dateId,
        days,
      });
    }
    return weeks;
  };

  const weeksList = useRef<WeekGroup[]>(generateFiveWeeks(selectedDateId)).current;

  const findActiveWeekIndex = (dateId: string): number => {
    const idx = weeksList.findIndex((w) => w.days.some((d) => d.dateId === dateId));
    return idx !== -1 ? idx : 2;
  };

  const activeWeekIndex = findActiveWeekIndex(selectedDateId);

  useEffect(() => {
    if (pagerRef.current && activeWeekIndex !== -1) {
      pagerRef.current.setPage(activeWeekIndex);
    }
  }, [selectedDateId, activeWeekIndex]);

  const handlePageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const pagePos = e.nativeEvent.position;
    const targetWeek = weeksList[pagePos];
    if (targetWeek) {
      const stillInWeek = targetWeek.days.some((d) => d.dateId === selectedDateId);
      if (!stillInWeek) {
        onSelectDate(targetWeek.days[0].dateId);
      }
    }
  };

  const handlePrevDay = () => {
    const curr = parseDateId(selectedDateId);
    curr.setDate(curr.getDate() - 1);
    onSelectDate(formatDateId(curr));
  };

  const handleNextDay = () => {
    const curr = parseDateId(selectedDateId);
    curr.setDate(curr.getDate() + 1);
    onSelectDate(formatDateId(curr));
  };

  const selDateObj = parseDateId(selectedDateId);
  const dayNameFull = DAY_NAMES_FULL_ES[selDateObj.getDay()];
  const dayNum = selDateObj.getDate();
  const monthNameFull = MONTH_NAMES_ES[selDateObj.getMonth()];
  const yearNum = selDateObj.getFullYear();
  const isSelectedToday = selectedDateId === todayDateId;

  const line1Text = isSelectedToday ? 'Hoy' : `${dayNameFull} ${dayNum}`;
  const line2Text = isSelectedToday ? `${dayNum} de ${monthNameFull}` : `${monthNameFull}, ${yearNum}`;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.border }]}>
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
            <Text style={[styles.headlineTitle, { color: theme.colors.text }]}>{line1Text}</Text>
            <Text style={[styles.subtitleContext, { color: theme.colors.textSecondary }]}>{line2Text}</Text>
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
            style={[styles.todayPillBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}
            delayPressIn={0}
            onPress={() => onSelectDate(todayDateId)}>
            <Text style={[styles.todayPillText, { color: theme.colors.primary }]}>Hoy</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2. Week Strip Pager */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={2}
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
                      { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                      isSelected && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                      item.isToday && !isSelected && { borderColor: theme.colors.primary },
                    ]}
                    delayPressIn={0}
                    activeOpacity={0.7}
                    onPress={() => onSelectDate(item.dateId)}>
                    <Text
                      style={[
                        styles.dayNameText,
                        { color: theme.colors.textMuted },
                        isSelected && { color: theme.colors.onPrimary, fontWeight: '700' },
                        item.isToday && !isSelected && { color: theme.colors.primary },
                      ]}>
                      {item.dayName}
                    </Text>

                    <Text
                      style={[
                        styles.dayNumberText,
                        { color: theme.colors.text },
                        isSelected && { color: theme.colors.onPrimary },
                        item.isToday && !isSelected && { color: theme.colors.primary },
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
