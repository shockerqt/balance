import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useMealStore, LoggedFoodItem, DayLog } from '@/hooks/use-meal-store';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { FluidTimelineFeed } from '@/components/meal/fluid-timeline-feed';
import { TimeFoodModal } from '@/components/meal/time-food-modal';

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

export default function LogsScreen() {
  const { selectedDateId, setSelectedDateId, currentDayLog, dayLogs, addFood, updateFood, deleteFood } = useMealStore();
  const pagerRef = useRef<PagerView>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedFood, setSelectedFood] = useState<LoggedFoodItem | null>(null);
  const [presetTime, setPresetTime] = useState<string>('08:30');

  // Helper to generate current 7-day week list (Monday to Sunday)
  const generateCurrentWeek = (): string[] => {
    const dates: string[] = [];
    const validBaseDate = parseDateId(selectedDateId);
    const currentDay = validBaseDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const startOffset = currentDay === 0 ? -6 : 1 - currentDay;

    const mondayDate = new Date(validBaseDate);
    mondayDate.setDate(validBaseDate.getDate() + startOffset);

    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(mondayDate.getDate() + i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    return dates;
  };

  const weekDateIds = generateCurrentWeek();
  const activePageIndex = Math.max(0, weekDateIds.indexOf(selectedDateId));

  // Sync PagerView position when selectedDateId changes via DateStripHeader or Ir a Hoy
  useEffect(() => {
    if (pagerRef.current && activePageIndex !== -1) {
      pagerRef.current.setPage(activePageIndex);
    }
  }, [selectedDateId, activePageIndex]);

  // Handle native page selection from user swipe
  const handlePageSelected = (e: PagerViewOnPageSelectedEvent) => {
    const pageIndex = e.nativeEvent.position;
    const targetDateId = weekDateIds[pageIndex];
    if (targetDateId && targetDateId !== selectedDateId) {
      setSelectedDateId(targetDateId);
    }
  };

  const getLogForDate = (dateId: string): DayLog => {
    return (
      dayLogs[dateId] || {
        dateId,
        displayDate: dateId,
        targetCalories: 2200,
        targetProtein: 150,
        targetCarbs: 220,
        targetFat: 65,
        targetFiber: 30,
        foods: [],
      }
    );
  };

  const handleOpenAddModal = (time?: string) => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${hours}:${minutes}`;

    setPresetTime(time || currentTimeStr);
    setSelectedFood(null);
    setModalVisible(true);
  };

  const handleOpenEditModal = (food: LoggedFoodItem) => {
    setSelectedFood(food);
    setPresetTime(food.time);
    setModalVisible(true);
  };

  const handleSaveFood = (foodData: Omit<LoggedFoodItem, 'id'>, foodId?: string) => {
    if (foodId) {
      updateFood(currentDayLog.dateId, foodId, foodData);
    } else {
      addFood(currentDayLog.dateId, foodData);
    }
  };

  const handleDeleteFood = (foodId: string) => {
    deleteFood(currentDayLog.dateId, foodId);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 1. Date Strip Navigation Header (Top position above macro header) */}
      <DateStripHeader
        selectedDateId={selectedDateId}
        onSelectDate={(dateId) => {
          setSelectedDateId(dateId);
          const index = weekDateIds.indexOf(dateId);
          if (index !== -1 && pagerRef.current) {
            pagerRef.current.setPage(index);
          }
        }}
      />

      {/* 2. Sticky Macro Summary Header */}
      <StickyMacroHeader
        foods={currentDayLog.foods}
        targetCalories={currentDayLog.targetCalories}
        targetProtein={currentDayLog.targetProtein}
        targetCarbs={currentDayLog.targetCarbs}
        targetFat={currentDayLog.targetFat}
        targetFiber={currentDayLog.targetFiber}
      />

      {/* 3. Official Native PagerView (UIPageViewController on iOS, ViewPager2 on Android) */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={activePageIndex}
        onPageSelected={handlePageSelected}>
        {weekDateIds.map((dateId) => {
          const log = getLogForDate(dateId);
          return (
            <View key={dateId} style={styles.page}>
              <FluidTimelineFeed
                foods={log.foods}
                onSelectFood={handleOpenEditModal}
                onAddAtTime={(time) => handleOpenAddModal(time)}
                onDeleteFood={handleDeleteFood}
              />
            </View>
          );
        })}
      </PagerView>

      {/* Floating Add Action Button */}
      <TouchableOpacity
        style={styles.floatingAddBtn}
        activeOpacity={0.8}
        onPress={() => handleOpenAddModal()}>
        <Text style={styles.floatingAddIcon}>+</Text>
      </TouchableOpacity>

      {/* Time-based Food Form Modal */}
      <TimeFoodModal
        visible={modalVisible}
        initialTime={presetTime}
        foodToEdit={selectedFood}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveFood}
        onDelete={handleDeleteFood}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080B11',
  },
  pagerView: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  floatingAddBtn: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
  },
  floatingAddIcon: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '400',
    marginTop: -2,
  },
});
