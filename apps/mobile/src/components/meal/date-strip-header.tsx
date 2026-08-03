import React, { useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';

export type WeekStartDay = 'monday' | 'sunday';

interface DateItem {
  dateId: string; // "YYYY-MM-DD"
  dayName: string; // "L", "M", "M", "J", "V", "S", "D"
  dayNumber: number; // 2, 28, 29...
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

// Helper to safely parse "YYYY-MM-DD" without UTC timezone shift
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
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef<PagerView>(null);

  const todayDateId = useRef<string>(formatDateId(new Date())).current;

  // Helper to generate 7 continuous days for a week starting from a base Monday/Sunday
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

  // Generate 5 continuous weeks (2 past, current, 2 future)
  const generateFiveWeeks = (centerDateId: string): WeekGroup[] => {
    const centerDate = parseDateId(centerDateId);
    const weeks: WeekGroup[] = [];

    for (let offset = -2; offset <= 2; offset++) {
      const wDate = new Date(centerDate);
      wDate.setDate(centerDate.getDate() + offset * 7);

      const days = buildWeekDays(wDate);
      weeks.push({
        weekIndex: offset + 2, // 0, 1, 2, 3, 4
        startDateId: days[0].dateId,
        days,
      });
    }
    return weeks;
  };

  const weeksList = useRef<WeekGroup[]>(generateFiveWeeks(selectedDateId)).current;

  // Find active week index in pager
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

  // Day-by-Day Navigation Handlers (-1 / +1 Day)
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

  // Option A Compact Date Hierarchy formatting
  const selDateObj = parseDateId(selectedDateId);
  const dayNameFull = DAY_NAMES_FULL_ES[selDateObj.getDay()];
  const dayNum = selDateObj.getDate();
  const monthNameFull = MONTH_NAMES_ES[selDateObj.getMonth()];
  const yearNum = selDateObj.getFullYear();
  const isSelectedToday = selectedDateId === todayDateId;

  const line1Text = isSelectedToday ? 'Hoy' : `${dayNameFull} ${dayNum}`;
  const line2Text = isSelectedToday ? `${dayNum} de ${monthNameFull}` : `${monthNameFull}, ${yearNum}`;

  return (
    <View style={styles.container}>
      {/* 1. Header Row with Day-by-Day Navigation & Fixed Date Box */}
      <View style={styles.topHeaderRow}>
        <View style={styles.fixedDateNavBox}>
          <TouchableOpacity
            style={styles.navArrowBtn}
            delayPressIn={0}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={handlePrevDay}>
            <Text style={styles.navArrowText}>‹</Text>
          </TouchableOpacity>

          {/* Center Date Display (Opens Expo Router FormSheet DatePicker) */}
          <TouchableOpacity
            style={styles.dateTitleBox}
            delayPressIn={0}
            activeOpacity={0.7}
            onPress={() => router.push('/date-picker')}>
            <Text style={styles.headlineTitle}>{line1Text}</Text>
            <Text style={styles.subtitleContext}>{line2Text}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navArrowBtn}
            delayPressIn={0}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={handleNextDay}>
            <Text style={styles.navArrowText}>›</Text>
          </TouchableOpacity>
        </View>

        {!isSelectedToday && (
          <TouchableOpacity
            style={styles.todayPillBtn}
            delayPressIn={0}
            onPress={() => onSelectDate(todayDateId)}>
            <Text style={styles.todayPillText}>Hoy</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2. Hardware Accelerated Week Strip Pager */}
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
                      isSelected && styles.dayPillSelected,
                      item.isToday && !isSelected && styles.dayPillToday,
                    ]}
                    delayPressIn={0}
                    activeOpacity={0.7}
                    onPress={() => onSelectDate(item.dateId)}>
                    <Text
                      style={[
                        styles.dayNameText,
                        isSelected && styles.dayNameTextSelected,
                        item.isToday && !isSelected && styles.dayNameTextToday,
                      ]}>
                      {item.dayName}
                    </Text>

                    <Text
                      style={[
                        styles.dayNumberText,
                        isSelected && styles.dayNumberTextSelected,
                        item.isToday && !isSelected && styles.dayNumberTextToday,
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
    backgroundColor: '#080B11',
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
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
    width: 240,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowText: {
    color: '#3B82F6',
    fontSize: 24,
    fontWeight: '300',
    marginTop: -2,
  },
  dateTitleBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headlineTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitleContext: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 1,
  },
  todayPillBtn: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  todayPillText: {
    color: '#3B82F6',
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
    backgroundColor: '#0E1420',
    borderWidth: 1,
    borderColor: '#1C2638',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  dayPillSelected: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  dayPillToday: {
    borderColor: '#3B82F6',
  },
  dayNameText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayNameTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dayNameTextToday: {
    color: '#3B82F6',
  },
  dayNumberText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dayNumberTextSelected: {
    color: '#FFFFFF',
  },
  dayNumberTextToday: {
    color: '#3B82F6',
  },
});
