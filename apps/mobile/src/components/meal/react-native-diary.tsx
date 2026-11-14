import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import Animated, { useAnimatedStyle, useAnimatedReaction, runOnJS, useSharedValue } from 'react-native-reanimated';
import { Button, Card, Text } from '@/components/ui';
import { useMealActions, useMealDay, type LoggedFoodItem } from '@/hooks/use-meal-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { logsDateStore, useLogsDateRevision, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, dateIdToEpochDay, todayId } from '@/lib/dates';
import { DateStripHeader } from './date-strip-header';
import { StickyMacroHeader } from './sticky-macro-header';
import { NativeDayWindow } from './native-day-window';
import { MealGroupFeed } from './meal-group-feed';
import { pageGeometry, type DiaryPagePresentation } from '@/lib/diary-presentation';
import { recordDiaryCommit } from '@/dev/native-pager-status';

export function ReactNativeDiary({ today = todayId() }: { today?: string }) {
  const active = useIsFocused();
  const [date] = useLogsSelectedDate();
  const revision = useLogsDateRevision();
  const [lockedDate, setLockedDate] = useState<string | null>(null);
  const position = useSharedValue(dateIdToEpochDay(date));
  const interaction = useSharedValue(0);
  useEffect(() => { setLockedDate(null); }, [date]);
  const settle = useCallback((target: string, expected: number) => {
    if (logsDateStore.getRevision() !== expected) return;
    logsDateStore.set(target);
    return logsDateStore.getRevision();
  }, []);
  const selectionChanged = useCallback((day: string, selected: boolean) => {
    if (logsDateStore.get() === day) setLockedDate(selected ? day : null);
  }, []);
  const renderDay = useCallback((day: string, presentation?: DiaryPagePresentation) => <DiaryDay date={day} today={today}
    onSelection={selectionChanged} presentation={presentation} active={active}
    headerEnabled={Math.abs(dateIdToEpochDay(day) - dateIdToEpochDay(date)) <= 1} />,
  [active, date, selectionChanged, today]);
  const body = <View style={{ flex: 1 }}>
    <NativeDayWindow dateId={date} revision={revision} readRevision={logsDateStore.getRevision}
      active={active} scrollEnabled={lockedDate !== date} position={position} interaction={interaction} onSettle={settle} renderDay={renderDay} />
  </View>;
  return __DEV__ ? <React.Profiler id="diary-presentation" onRender={(_id, _phase, duration) => recordDiaryCommit(duration)}>{body}</React.Profiler> : body;
}

const DiaryDay = React.memo(function DiaryDay({ date, today, onSelection, presentation, active, headerEnabled }: {
  date: string; today: string; presentation?: DiaryPagePresentation; active: boolean; headerEnabled: boolean;
  onSelection: (date: string, selected: boolean) => void;
}) {
  const router = useRouter();
  const scrollOffset = useSharedValue(0);
  const dayNumber = dateIdToEpochDay(date);
  const localPosition = useSharedValue(dayNumber);
  const headerTouch = useCallback((down: boolean) => {
    'worklet';
    if (presentation?.motion.value.visual === dayNumber) presentation.headerTouch(down);
  }, [dayNumber, presentation]);
  const [compact, setCompact] = useState(false);
  const [headerSize, setHeaderSize] = useState({ expanded: 136, compact: 78, measured: false });
  const [summarySize, setSummarySize] = useState({ expanded: 188, compact: 30, measured: false });
  const measureHeader = useCallback((expanded: number, compactHeight: number) => {
    setHeaderSize(previous => previous.measured && previous.expanded === expanded && previous.compact === compactHeight
      ? previous : { expanded, compact: compactHeight, measured: true });
  }, []);
  const measureSummary = useCallback((expanded: number, compactHeight: number) => {
    setSummarySize(previous => previous.measured && previous.expanded === expanded && previous.compact === compactHeight
      ? previous : { expanded, compact: compactHeight, measured: true });
  }, []);
  const geometry = useMemo(() => pageGeometry(headerSize.expanded, headerSize.compact, summarySize.expanded, summarySize.compact), [headerSize, summarySize]);
  useAnimatedReaction(() => scrollOffset.value >= geometry.distance / 2, (next, prev) => {
    if (next !== prev) runOnJS(setCompact)(next);
  });
  const headerStyle = useAnimatedStyle(() => ({ height: headerSize.expanded - (headerSize.expanded - headerSize.compact)
    * Math.min(1, Math.max(0, scrollOffset.value / geometry.distance)) }));
  const summaryStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, scrollOffset.value / geometry.distance));
    return { top: headerSize.expanded - (headerSize.expanded - headerSize.compact) * p,
      height: summarySize.expanded - (summarySize.expanded - summarySize.compact) * p };
  });
  const log = useMealDay(date);
  const currentLog = useRef(log);
  useLayoutEffect(() => { currentLog.current = log; }, [log]);
  const { deleteMultipleFoods } = useMealActions();
  const selection = useFoodSelection(date);
  const focused = useRef(false);
  const preference = usePreferencesStore();
  const live = useCallback(() => focused.current && logsDateStore.get() === date && (!presentation ||
    (presentation.motion.value.enabled && presentation.motion.value.phase === 0 && presentation.motion.value.visual === dayNumber)), [date, dayNumber, presentation]);
  const selectDate = useCallback((next: string) => { if (live()) logsDateStore.set(next); }, [live]);
  const shiftDate = useCallback((days: number) => { if (live()) logsDateStore.shift(days); }, [live]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; selection.clear(); onSelection(date, false); };
  }, [date, onSelection, selection.clear]));
  useEffect(() => logsDateStore.subscribe(() => {
    if (logsDateStore.get() !== date) selection.clear();
  }), [date, selection.clear]);
  useEffect(() => {
    onSelection(date, selection.isSelectionMode);
  }, [date, onSelection, selection.isSelectionMode]);
  useEffect(() => {
    if (Array.from(selection.selectedIds).some(id => !log.foods.some(food => food.id === id))) selection.clear();
  }, [log.foods, selection.selectedIds, selection.clear]);
  const openSearch = (time = currentTimeString()) => {
    if (live() && !selection.isSelectionMode) router.push({ pathname: '/food-search', params: { dateId: date, time } });
  };
  const openEdit = (food: LoggedFoodItem) => {
    if (live() && !selection.isSelectionMode && log.foods.some(f => f.id === food.id))
      router.push({ pathname: '/food-edit', params: { dateId: date, foodId: food.id } });
  };
  const openBatch = (pathname: '/batch-copy' | '/batch-move') => {
    if (!live() || !selection.selectedCount) return;
    // The destination obtains canonical revisions before accepting any mutation.
    router.push({ pathname, params: { dateId: date, ids: Array.from(selection.selectedIds).join(',') } });
    selection.clear();
  };
  const remove = () => {
    if (!live() || !selection.selectedCount) return;
    const ids = Array.from(selection.selectedIds);
    const expectedRevision = logsDateStore.getRevision();
    const sources = ids.map(id => currentLog.current.foods.find(food => food.id === id));
    Alert.alert('Eliminar registros', `¿Eliminar ${ids.length} registros de este día?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => {
        if (live() && logsDateStore.getRevision() === expectedRevision && ids.every((id, i) => sources[i] && currentLog.current.foods.find(food => food.id === id) === sources[i])) {
          deleteMultipleFoods(date, ids); selection.clear();
        }
      } },
    ]);
  };
  const future = date > today;
  // The feed keeps its own stable event adapters; a stable empty state lets it skip work when only the parent re-renders.
  const empty = useMemo(() => <Card padding="none" style={{ marginHorizontal: 20, marginTop: 14, paddingVertical: 28, paddingHorizontal: 18, alignItems: 'center', gap: 8 }}>
    <Text variant="heading">{future ? 'Este día todavía no llega' : 'Sin registros este día'}</Text>
    <Text tone="secondary" style={{ fontSize: 14, textAlign: 'center' }}>{future ? 'Puedes planificar comidas con el botón +.' : 'Agrega lo que comiste con el botón +.'}</Text>
  </Card>, [future]);
  return <View style={{ flex: 1 }}>
    {headerEnabled ? <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, overflow: 'hidden' }, headerStyle]}>
      <DateStripHeader pageLocal compact={compact} collapseScroll={scrollOffset} collapseDistance={geometry.distance}
        selectedDateId={date} onSelectDate={selectDate}
        onShiftDate={shiftDate} pagerPosition={localPosition}
        pagerInteraction={presentation?.interaction} onHeaderTouch={headerTouch}
        active={active && logsDateStore.get() === date} onMeasure={measureHeader} />
    </Animated.View> : null}
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, zIndex: 4, overflow: 'hidden' }, summaryStyle]}>
      <StickyMacroHeader {...log} targetCalories={preference.dailyCalorieTarget} foods={log.foods}
        collapseScroll={scrollOffset} collapseDistance={geometry.distance} onMeasure={measureSummary}
        onPress={() => { if (live() && !selection.isSelectionMode) router.push({ pathname: '/day-nutrition', params: { dateId: date } }); }} />
    </Animated.View>
    <MealGroupFeed scrollOffset={scrollOffset} showMacros={preference.diaryMacrosEnabled} foods={log.foods} empty={empty}
      dayNumber={dayNumber} presentation={presentation} prefix={geometry.prefix} collapseDistance={geometry.distance}
      headerReady={headerEnabled && headerSize.measured && summarySize.measured}
      onSelectFood={openEdit} onAddAtHour={openSearch} isSelectionMode={selection.isSelectionMode} selectedFoodIds={selection.selectedIds}
      onLongPressFood={food => { if (live()) selection.startFromFood(food); }}
      onLongPressGroup={ids => { if (live()) selection.startFromGroup(ids); }}
      onToggleSelectFood={id => { if (live()) selection.toggleFood(id); }}
      onToggleSelectGroup={ids => { if (live()) selection.toggleGroup(ids); }} />
    {selection.isSelectionMode ? <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}>
      <Button title={`${selection.selectedCount} seleccionados · Cancelar`} variant="secondary" size="md" onPress={selection.clear} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Button title="Mover" size="md" style={{ flex: 1, paddingHorizontal: 6 }} onPress={() => openBatch('/batch-move')} />
        <Button title="Copiar" size="md" style={{ flex: 1, paddingHorizontal: 6 }} onPress={() => openBatch('/batch-copy')} />
        <Button title="Eliminar" size="md" variant="danger" style={{ flex: 1, paddingHorizontal: 6 }} onPress={remove} />
      </View>
    </View> : null}
  </View>;
});
