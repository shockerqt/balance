import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

interface DatePickerModalProps {
  visible: boolean;
  selectedDateId: string;
  onClose: () => void;
  onSelectDate: (dateId: string) => void;
}

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const WEEKDAY_NAMES_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

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

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  selectedDateId,
  onClose,
  onSelectDate,
}) => {
  const [viewDate, setViewDate] = useState<Date>(parseDateId(selectedDateId));

  useEffect(() => {
    if (visible) {
      setViewDate(parseDateId(selectedDateId));
    }
  }, [visible, selectedDateId]);

  const now = new Date();
  const todayStr = formatDateId(now);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  // Generate calendar grid for current month
  const generateMonthGrid = () => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const totalDays = lastDayOfMonth.getDate();
    let startDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sun, 1 = Mon...
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // 0 = Mon ... 6 = Sun

    const grid: ({ dateId: string; dayNumber: number; isCurrentMonth: boolean } | null)[] = [];

    // Empty padding cells for days before start of month
    for (let i = 0; i < startDayOfWeek; i++) {
      grid.push(null);
    }

    // Days of current month
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const d = new Date(year, month, dayNum);
      const dateId = formatDateId(d);
      grid.push({
        dateId,
        dayNumber: dayNum,
        isCurrentMonth: true,
      });
    }

    return grid;
  };

  const grid = generateMonthGrid();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.modalCard}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={handlePrevMonth} style={styles.navBtn}>
                  <Text style={styles.navBtnText}>‹</Text>
                </TouchableOpacity>

                <Text style={styles.monthYearTitle}>
                  {MONTH_NAMES_ES[month]} {year}
                </Text>

                <TouchableOpacity onPress={handleNextMonth} style={styles.navBtn}>
                  <Text style={styles.navBtnText}>›</Text>
                </TouchableOpacity>
              </View>

              {/* Weekday Labels */}
              <View style={styles.weekdayRow}>
                {WEEKDAY_NAMES_SHORT.map((name, idx) => (
                  <Text key={idx} style={styles.weekdayText}>
                    {name}
                  </Text>
                ))}
              </View>

              {/* Calendar Days Grid */}
              <View style={styles.gridContainer}>
                {grid.map((cell, idx) => {
                  if (!cell) {
                    return <View key={`empty_${idx}`} style={styles.dayCell} />;
                  }

                  const isSelected = cell.dateId === selectedDateId;
                  const isToday = cell.dateId === todayStr;

                  return (
                    <TouchableOpacity
                      key={cell.dateId}
                      style={[
                        styles.dayCell,
                        isSelected && styles.dayCellSelected,
                        isToday && !isSelected && styles.dayCellToday,
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        onSelectDate(cell.dateId);
                        onClose();
                      }}>
                      <Text
                        style={[
                          styles.dayCellText,
                          isSelected && styles.dayCellTextSelected,
                          isToday && !isSelected && styles.dayCellTextToday,
                        ]}>
                        {cell.dayNumber}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Footer Actions */}
              <View style={styles.footerRow}>
                <TouchableOpacity
                  style={styles.todayQuickBtn}
                  onPress={() => {
                    onSelectDate(todayStr);
                    onClose();
                  }}>
                  <Text style={styles.todayQuickBtnText}>Ir a Hoy</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                  <Text style={styles.closeBtnText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 6, 10, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0E1420',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#1C2638',
    padding: 18,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  monthYearTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  navBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  navBtnText: {
    color: '#3B82F6',
    fontSize: 24,
    fontWeight: '700',
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
    paddingBottom: 8,
  },
  weekdayText: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '600',
    width: 36,
    textAlign: 'center',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  dayCell: {
    width: '14.28%', // 100% / 7 days
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    borderRadius: 10,
  },
  dayCellSelected: {
    backgroundColor: '#3B82F6',
  },
  dayCellToday: {
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  dayCellText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dayCellTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dayCellTextToday: {
    color: '#3B82F6',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1C2638',
  },
  todayQuickBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  todayQuickBtnText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeBtnText: {
    color: '#8E9BAE',
    fontSize: 13,
    fontWeight: '600',
  },
});
