import React, { useRef, useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';

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
  const { width: windowWidth } = useWindowDimensions();
  const headerPagerRef = useRef<PagerView>(null);
  const prevSelectedDateIdRef = useRef<string>(selectedDateId);

  // Calculate exact uniform width for each of the 7 pills
  const pillWidth = Math.floor((windowWidth - 32 - 36) / 7);

  const now = new Date();
  const todayStr = formatDateId(now);
  const isSelectedToday = selectedDateId === todayStr;

  // Generate 11 continuous weeks (-5 to +5 around today)
  const generateWeekGroups = (): WeekGroup[] => {
    const groups: WeekGroup[] = [];
    const baseDate = parseDateId(todayStr);
    const currentDay = baseDate.getDay();
    const startOffset = currentDay === 0 ? -6 : 1 - currentDay;

    const referenceMonday = new Date(baseDate);
    referenceMonday.setDate(baseDate.getDate() + startOffset);

    for (let w = -5; w <= 5; w++) {
      const weekMonday = new Date(referenceMonday);
      weekMonday.setDate(referenceMonday.getDate() + w * 7);

      const dayNames = weekStartsOn === 'monday'
        ? ['L', 'M', 'M', 'J', 'V', 'S', 'D']
        : ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

      const days: DateItem[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekMonday);
        d.setDate(weekMonday.getDate() + i);
        const dateId = formatDateId(d);

        days.push({
          dateId,
          dayName: dayNames[i],
          dayNumber: d.getDate(),
          isToday: dateId === todayStr,
        });
      }

      groups.push({
        weekIndex: w + 5, // 0 to 10 (5 is center = current week)
        startDateId: formatDateId(weekMonday),
        days,
      });
    }

    return groups;
  };

  const weekGroups = useRef<WeekGroup[]>(generateWeekGroups()).current;
  const [visibleWeekIndex, setVisibleWeekIndex] = useState<number>(5);

  // Sync PagerView page ONLY when selectedDateId explicitly changes (e.g. Hoy button or day tap)
  useEffect(() => {
    if (prevSelectedDateIdRef.current !== selectedDateId) {
      prevSelectedDateIdRef.current = selectedDateId;
      const targetIndex = weekGroups.findIndex((g) =>
        g.days.some((d) => d.dateId === selectedDateId)
      );
      if (targetIndex !== -1 && headerPagerRef.current) {
        headerPagerRef.current.setPage(targetIndex);
        setVisibleWeekIndex(targetIndex);
      }
    }
  }, [selectedDateId, weekGroups]);

  // Handle native PagerView swipe: ONLY update visible week index
  const handleWeekPageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const pageIndex = e.nativeEvent.position;
    setVisibleWeekIndex(pageIndex);
  };

  // Format full readable date header string
  const getReadableHeader = (): { monthYear: string; fullDateLabel: string } => {
    const d = parseDateId(selectedDateId);
    const dayName = DAY_NAMES_FULL_ES[d.getDay()];
    const dayNum = d.getDate();
    const monthName = MONTH_NAMES_ES[d.getMonth()];
    const year = d.getFullYear();

    return {
      monthYear: `${monthName} ${year}`,
      fullDateLabel: `${dayName} ${dayNum} de ${monthName}`,
    };
  };

  const { monthYear, fullDateLabel } = getReadableHeader();

  const handlePrevWeek = () => {
    if (visibleWeekIndex > 0) {
      const newIndex = visibleWeekIndex - 1;
      headerPagerRef.current?.setPage(newIndex);
      setVisibleWeekIndex(newIndex);
    }
  };

  const handleNextWeek = () => {
    if (visibleWeekIndex < weekGroups.length - 1) {
      const newIndex = visibleWeekIndex + 1;
      headerPagerRef.current?.setPage(newIndex);
      setVisibleWeekIndex(newIndex);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header: Centered Date Title & Compact 'Hoy' Button */}
      <View style={styles.topHeaderRow}>
        <View style={styles.titleBoxCentered}>
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={handlePrevWeek} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.navArrowText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthYearText}>{monthYear}</Text>
            <TouchableOpacity onPress={handleNextWeek} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.navArrowText}>›</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.fullDateText}>
            {isSelectedToday ? '📍 Hoy' : fullDateLabel}
          </Text>
        </View>

        {!isSelectedToday && (
          <TouchableOpacity
            style={styles.todayBtn}
            activeOpacity={0.7}
            onPress={() => onSelectDate(todayStr)}>
            <Text style={styles.todayBtnText}>Hoy</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Official Native PagerView */}
      <PagerView
        ref={headerPagerRef}
        style={styles.headerPagerView}
        initialPage={5}
        onPageSelected={handleWeekPageSelected}>
        {weekGroups.map((group) => (
          <View key={group.startDateId} style={styles.weekRow}>
            {group.days.map((item) => {
              const isSelected = item.dateId === selectedDateId;

              return (
                <TouchableOpacity
                  key={item.dateId}
                  style={[
                    styles.pill,
                    { width: pillWidth },
                    isSelected && styles.pillActive,
                    item.isToday && !isSelected && styles.pillToday,
                  ]}
                  activeOpacity={0.7}
                  onPress={() => onSelectDate(item.dateId)}>
                  <Text
                    style={[
                      styles.dayNameText,
                      isSelected && styles.dayNameActive,
                      item.isToday && !isSelected && styles.dayNameToday,
                    ]}>
                    {item.dayName}
                  </Text>
                  <Text
                    style={[
                      styles.dayNumText,
                      isSelected && styles.dayNumActive,
                      item.isToday && !isSelected && styles.dayNumToday,
                    ]}>
                    {item.dayNumber}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </PagerView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#080B11',
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    minHeight: 36,
    marginBottom: 8,
  },
  titleBoxCentered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navArrowText: {
    color: '#3B82F6',
    fontSize: 22,
    fontWeight: '700',
    marginTop: -2,
  },
  monthYearText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  fullDateText: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 1,
  },
  todayBtn: {
    position: 'absolute',
    right: 0,
    top: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  todayBtnText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '600',
  },
  headerPagerView: {
    height: 48,
    width: '100%',
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  pill: {
    height: 44,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#0E1420',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  pillActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
  },
  pillToday: {
    borderColor: '#3B82F6',
  },
  dayNameText: {
    color: '#8E9BAE',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 1,
  },
  dayNameActive: {
    color: '#FFFFFF',
  },
  dayNameToday: {
    color: '#3B82F6',
  },
  dayNumText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dayNumActive: {
    color: '#FFFFFF',
  },
  dayNumToday: {
    color: '#3B82F6',
  },
});
