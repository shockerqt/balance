import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';

export type WeekStartDay = 'monday' | 'sunday';

interface DateItem {
  dateId: string; // "YYYY-MM-DD"
  dayName: string; // "L", "M", "M", "J", "V", "S", "D"
  dayNumber: number; // 2, 28, 29...
  isToday: boolean;
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

export const DateStripHeader: React.FC<DateStripHeaderProps> = ({
  selectedDateId,
  onSelectDate,
  weekStartsOn = 'monday',
}) => {
  const { width: windowWidth } = useWindowDimensions();

  // Calculate exact uniform width for each of the 7 pills
  const pillWidth = Math.floor((windowWidth - 32 - 36) / 7);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isSelectedToday = selectedDateId === todayStr;

  // Format full readable date header string (e.g. "Domingo 2 de Agosto, 2026")
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

  // Helper to calculate the 7 days of the current week based on selectedDateId
  const generateCurrentWeek = (): DateItem[] => {
    const dates: DateItem[] = [];
    const validBaseDate = parseDateId(selectedDateId);
    const currentDay = validBaseDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

    let startOffset = 0;
    if (weekStartsOn === 'monday') {
      startOffset = currentDay === 0 ? -6 : 1 - currentDay;
    } else {
      startOffset = -currentDay;
    }

    const mondayDate = new Date(validBaseDate);
    mondayDate.setDate(validBaseDate.getDate() + startOffset);

    const dayNames = weekStartsOn === 'monday'
      ? ['L', 'M', 'M', 'J', 'V', 'S', 'D']
      : ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateId = `${year}-${month}-${day}`;

      dates.push({
        dateId,
        dayName: dayNames[i],
        dayNumber: d.getDate(),
        isToday: dateId === todayStr,
      });
    }
    return dates;
  };

  const weekList = generateCurrentWeek();

  return (
    <View style={styles.container}>
      {/* Top Header: Month/Year Title & Smart 'Ir a Hoy' Button */}
      <View style={styles.topHeaderRow}>
        <View style={styles.titleBox}>
          <Text style={styles.monthYearText}>{monthYear}</Text>
          <Text style={styles.fullDateText}>
            {isSelectedToday ? '📍 Hoy' : fullDateLabel}
          </Text>
        </View>

        {!isSelectedToday && (
          <TouchableOpacity
            style={styles.todayBtn}
            activeOpacity={0.7}
            onPress={() => onSelectDate(todayStr)}>
            <Text style={styles.todayBtnText}>Ir a Hoy</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 7-Day Uniform Week Strip */}
      <View style={styles.weekRow}>
        {weekList.map((item) => {
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
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleBox: {
    flexDirection: 'column',
  },
  monthYearText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  fullDateText: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '400',
  },
  todayBtn: {
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
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  pill: {
    height: 44,
    borderRadius: 12,
    borderCurve: 'continuous', // Apple HIG smooth corners from expo-native-ui
    backgroundColor: '#0E1420',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  pillActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)', // modern boxShadow from expo-native-ui
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
    fontVariant: ['tabular-nums'], // expo-native-ui numeric alignment
  },
  dayNumActive: {
    color: '#FFFFFF',
  },
  dayNumToday: {
    color: '#3B82F6',
  },
});
