import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PagerView, { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useMealStore, LoggedFoodItem, DayLog } from '@/hooks/use-meal-store';
import { DateStripHeader } from '@/components/meal/date-strip-header';
import { StickyMacroHeader } from '@/components/meal/sticky-macro-header';
import { FluidTimelineFeed } from '@/components/meal/fluid-timeline-feed';
import { TimeFoodModal } from '@/components/meal/time-food-modal';
import { BatchMoveModal } from '@/components/meal/batch-move-modal';
import { useTheme, makeStyles } from '@/theme';

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
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const {
    selectedDateId,
    setSelectedDateId,
    currentDayLog,
    dayLogs,
    addFood,
    updateFood,
    deleteFood,
    deleteMultipleFoods,
    moveMultipleFoodsTime,
  } = useMealStore();
  const pagerRef = useRef<PagerView>(null);

  // Modal States
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedFood, setSelectedFood] = useState<LoggedFoodItem | null>(null);
  const [presetTime, setPresetTime] = useState<string>('08:30');

  // Multi-select & Batch Actions State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFoodIds, setSelectedFoodIds] = useState<Set<string>>(new Set());
  const [batchMoveModalVisible, setBatchMoveModalVisible] = useState(false);

  const generateMultiWeekDateIds = (): string[] => {
    const dates: string[] = [];
    const validBaseDate = parseDateId(selectedDateId);
    const currentDay = validBaseDate.getDay();
    const startOffset = currentDay === 0 ? -6 : 1 - currentDay;

    const currentMonday = new Date(validBaseDate);
    currentMonday.setDate(validBaseDate.getDate() + startOffset);

    const startMonday = new Date(currentMonday);
    startMonday.setDate(currentMonday.getDate() - 14);

    for (let i = 0; i < 35; i++) {
      const d = new Date(startMonday);
      d.setDate(startMonday.getDate() + i);

      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    return dates;
  };

  const weekDateIds = useRef<string[]>(generateMultiWeekDateIds()).current;

  let activePageIndex = weekDateIds.indexOf(selectedDateId);
  if (activePageIndex === -1) {
    const newDates = generateMultiWeekDateIds();
    weekDateIds.length = 0;
    weekDateIds.push(...newDates);
    activePageIndex = weekDateIds.indexOf(selectedDateId);
  }

  useEffect(() => {
    setIsSelectionMode(false);
    setSelectedFoodIds(new Set());
    if (pagerRef.current && activePageIndex !== -1) {
      pagerRef.current.setPage(activePageIndex);
    }
  }, [selectedDateId, activePageIndex]);

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
    const targetTime = time || currentTimeStr;

    router.push({
      pathname: '/food-search',
      params: { dateId: selectedDateId, time: targetTime },
    });
  };

  const handleOpenEditModal = (food: LoggedFoodItem) => {
    if (isSelectionMode) return;
    setSelectedFood(food);
    setPresetTime(food.time);
    setEditModalVisible(true);
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

  const handleLongPressFood = (food: LoggedFoodItem) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedFoodIds(new Set([food.id]));
    }
  };

  const handleLongPressGroup = (_timeKey: string, groupFoodIds: string[]) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedFoodIds(new Set(groupFoodIds));
    }
  };

  const handleToggleSelectFood = (foodId: string) => {
    const nextSet = new Set(selectedFoodIds);
    if (nextSet.has(foodId)) {
      nextSet.delete(foodId);
    } else {
      nextSet.add(foodId);
    }

    if (nextSet.size === 0) {
      setIsSelectionMode(false);
    }
    setSelectedFoodIds(nextSet);
  };

  const handleToggleSelectGroup = (_timeKey: string, groupFoodIds: string[]) => {
    const nextSet = new Set(selectedFoodIds);
    const isAllSelected = groupFoodIds.every((id) => nextSet.has(id));

    if (isAllSelected) {
      groupFoodIds.forEach((id) => nextSet.delete(id));
    } else {
      groupFoodIds.forEach((id) => nextSet.add(id));
    }

    if (nextSet.size === 0) {
      setIsSelectionMode(false);
    }
    setSelectedFoodIds(nextSet);
  };

  const handleCancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedFoodIds(new Set());
  };

  const handleBatchDelete = () => {
    const idsArray = Array.from(selectedFoodIds);
    if (idsArray.length > 0) {
      deleteMultipleFoods(selectedDateId, idsArray);
      handleCancelSelection();
    }
  };

  const handleBatchMoveConfirm = (newTime: string) => {
    const idsArray = Array.from(selectedFoodIds);
    if (idsArray.length > 0) {
      moveMultipleFoodsTime(selectedDateId, idsArray, newTime);
      handleCancelSelection();
    }
  };

  const selectedCount = selectedFoodIds.size;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      {/* 1. Date Strip Navigation Header */}
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

      {/* 3. Official Native PagerView with Multi-Select Support */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        scrollEnabled={!isSelectionMode}
        initialPage={activePageIndex !== -1 ? activePageIndex : 14}
        onPageSelected={handlePageSelected}>
        {weekDateIds.map((dateId, idx) => {
          const isNearbyActive = Math.abs(idx - activePageIndex) <= 2;
          const log = getLogForDate(dateId);

          return (
            <View key={dateId} style={styles.page}>
              {isNearbyActive ? (
                <FluidTimelineFeed
                  foods={log.foods}
                  onSelectFood={handleOpenEditModal}
                  onAddAtTime={(time) => handleOpenAddModal(time)}
                  onDeleteFood={handleDeleteFood}
                  isSelectionMode={isSelectionMode}
                  selectedFoodIds={selectedFoodIds}
                  onLongPressFood={handleLongPressFood}
                  onLongPressGroup={handleLongPressGroup}
                  onToggleSelectFood={handleToggleSelectFood}
                  onToggleSelectGroup={handleToggleSelectGroup}
                />
              ) : (
                <View style={styles.page} />
              )}
            </View>
          );
        })}
      </PagerView>

      {/* Floating Add Action Button */}
      {!isSelectionMode && (
        <TouchableOpacity
          style={[styles.floatingAddBtn, { backgroundColor: theme.colors.primary }]}
          delayPressIn={0}
          activeOpacity={0.8}
          onPress={() => handleOpenAddModal()}>
          <Text style={[styles.floatingAddIcon, { color: theme.colors.onPrimary }]}>+</Text>
        </TouchableOpacity>
      )}

      {/* Single Consolidated Bottom Floating Batch Action Bar */}
      {isSelectionMode && (
        <View style={[styles.bottomBatchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <TouchableOpacity style={[styles.batchBarBtnCancel, { backgroundColor: theme.colors.border }]} delayPressIn={0} onPress={handleCancelSelection}>
            <Text style={[styles.batchBarBtnCancelText, { color: theme.colors.textSecondary }]}>Cancelar</Text>
          </TouchableOpacity>

          <Text style={[styles.batchBarCountText, { color: theme.colors.text }]}>
            {selectedCount} {selectedCount === 1 ? 'seleccionado' : 'seleccionados'}
          </Text>

          <View style={styles.batchBarActionsGroup}>
            <TouchableOpacity
              style={[styles.batchBarBtnMove, { backgroundColor: theme.colors.border, borderColor: theme.colors.primary }]}
              delayPressIn={0}
              onPress={() => setBatchMoveModalVisible(true)}>
              <Text style={[styles.batchBarBtnMoveText, { color: theme.colors.primary }]}>Mover</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.batchBarBtnDelete, { backgroundColor: theme.colors.danger }]} delayPressIn={0} onPress={handleBatchDelete}>
              <Text style={[styles.batchBarBtnDeleteText, { color: theme.colors.onPrimary }]}>Eliminar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Single Food Edit Modal */}
      <TimeFoodModal
        visible={editModalVisible}
        initialTime={presetTime}
        foodToEdit={selectedFood}
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveFood}
        onDelete={handleDeleteFood}
      />

      {/* Batch Move Time Modal */}
      <BatchMoveModal
        visible={batchMoveModalVisible}
        selectedCount={selectedCount}
        onClose={() => setBatchMoveModalVisible(false)}
        onConfirmMove={handleBatchMoveConfirm}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
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
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: t.colors.primary,
  },
  floatingAddIcon: {
    fontSize: 28,
    fontWeight: '400',
    marginTop: -2,
  },
  bottomBatchBar: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: t.colors.shadow,
  },
  batchBarBtnCancel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  batchBarBtnCancelText: {
    fontSize: 13,
    fontWeight: '600',
  },
  batchBarCountText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  batchBarActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batchBarBtnMove: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  batchBarBtnMoveText: {
    fontSize: 13,
    fontWeight: '600',
  },
  batchBarBtnDelete: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  batchBarBtnDeleteText: {
    fontSize: 13,
    fontWeight: '700',
  },
}));
