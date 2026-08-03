import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useMealStore } from '@/hooks/use-meal-store';

export default function DatePickerScreen() {
  const router = useRouter();
  const { selectedDateId, setSelectedDateId } = useMealStore();

  const parseDate = (dStr: string) => {
    const parts = dStr.split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date();
  };

  const initialDate = parseDate(selectedDateId);
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const getDaysInMonthGrid = () => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);

    let startOffset = firstDay.getDay() - 1;
    if (startOffset === -1) startOffset = 6;

    const daysCount = lastDay.getDate();
    const cells: (number | null)[] = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysCount; d++) {
      cells.push(d);
    }
    return cells;
  };

  const handleSelectDayNumber = (dayNum: number) => {
    const mm = String(currentMonth + 1).padStart(2, '0');
    const dd = String(dayNum).padStart(2, '0');
    const newDateId = `${currentYear}-${mm}-${dd}`;

    setSelectedDateId(newDateId);
    router.back();
  };

  const handleSelectToday = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');

    setSelectedDateId(`${y}-${m}-${d}`);
    router.back();
  };

  const cells = getDaysInMonthGrid();

  return (
    <View style={styles.container}>
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.closeBtn} delayPressIn={0} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>✕ Cerrar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Seleccionar Fecha</Text>
      </View>

      {/* Month Navigator Header */}
      <View style={styles.monthNavRow}>
        <TouchableOpacity style={styles.arrowBtn} delayPressIn={0} onPress={handlePrevMonth}>
          <Text style={styles.arrowText}>◄</Text>
        </TouchableOpacity>

        <Text style={styles.monthYearTitle}>
          {monthNames[currentMonth]} {currentYear}
        </Text>

        <TouchableOpacity style={styles.arrowBtn} delayPressIn={0} onPress={handleNextMonth}>
          <Text style={styles.arrowText}>►</Text>
        </TouchableOpacity>
      </View>

      {/* Weekday Labels Row */}
      <View style={styles.weekDaysRow}>
        {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((wd, i) => (
          <Text key={i} style={styles.weekDayLabel}>
            {wd}
          </Text>
        ))}
      </View>

      {/* Days Grid */}
      <View style={styles.daysGrid}>
        {cells.map((dayNum, index) => {
          if (dayNum === null) {
            return <View key={index} style={styles.emptyCell} />;
          }

          const mm = String(currentMonth + 1).padStart(2, '0');
          const dd = String(dayNum).padStart(2, '0');
          const cellDateId = `${currentYear}-${mm}-${dd}`;
          const isSelected = cellDateId === selectedDateId;

          return (
            <TouchableOpacity
              key={index}
              style={[styles.dayCell, isSelected && styles.dayCellSelected]}
              delayPressIn={0}
              onPress={() => handleSelectDayNumber(dayNum)}>
              <Text style={[styles.dayCellText, isSelected && styles.dayCellTextSelected]}>
                {dayNum}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Today Quick Button */}
      <TouchableOpacity style={styles.todayBtn} delayPressIn={0} onPress={handleSelectToday}>
        <Text style={styles.todayBtnText}>Ir a Hoy</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1420',
    padding: 20,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  closeBtn: {
    paddingRight: 12,
  },
  closeBtnText: {
    color: '#8E9BAE',
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 'auto',
    marginRight: 'auto',
    paddingRight: 50,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  arrowBtn: {
    padding: 8,
  },
  arrowText: {
    color: '#3B82F6',
    fontSize: 14,
  },
  monthYearTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  weekDaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  weekDayLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    width: 36,
    textAlign: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    marginBottom: 20,
  },
  emptyCell: {
    width: '14.28%',
    height: 40,
  },
  dayCell: {
    width: '14.28%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dayCellSelected: {
    backgroundColor: '#3B82F6',
  },
  dayCellText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  dayCellTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  todayBtn: {
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 'auto',
  },
  todayBtnText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '600',
  },
});
