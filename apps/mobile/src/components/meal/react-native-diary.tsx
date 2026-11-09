import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useSharedValue } from 'react-native-reanimated';
import { Button, Text } from '@/components/ui';
import { DailyWeightRow } from '@/components/weight/daily-weight-row';
import { useMealActions, useMealDay, type LoggedFoodItem } from '@/hooks/use-meal-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { useFoodSelection } from '@/hooks/use-food-selection';
import { logsDateStore, useLogsDateRevision, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, dateIdToEpochDay, todayId } from '@/lib/dates';
import { DateStripHeader } from './date-strip-header';
import { StickyMacroHeader } from './sticky-macro-header';
import { NativeDayWindow } from './native-day-window';
import { RecyclingHourRailFeed } from './recycling-hour-rail-feed';
import type { HourRailFeedHandle } from './hour-rail-feed';

export function ReactNativeDiary({ today = todayId() }: { today?: string }) {
  const active = useIsFocused();
  const [date, setDate] = useLogsSelectedDate();
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
  const renderDay = useCallback((day: string) => <DiaryDay date={day} today={today} onSelection={selectionChanged} />, [selectionChanged, today]);
  return <View style={{ flex: 1 }}>
    <DateStripHeader selectedDateId={date} onSelectDate={setDate} onShiftDate={logsDateStore.shift} pagerPosition={position} />
    <NativeDayWindow dateId={date} revision={revision} readRevision={logsDateStore.getRevision}
      active={active} scrollEnabled={lockedDate !== date} position={position} interaction={interaction} onSettle={settle} renderDay={renderDay} />
  </View>;
}

const DiaryDay = React.memo(function DiaryDay({ date, today, onSelection }: { date: string; today: string; onSelection: (date: string, selected: boolean) => void }) {
  const router = useRouter();
  const log = useMealDay(date);
  const currentLog = useRef(log);
  useLayoutEffect(() => { currentLog.current = log; }, [log]);
  const { deleteMultipleFoods } = useMealActions();
  const selection = useFoodSelection(date);
  const feed = useRef<HourRailFeedHandle>(null);
  const focused = useRef(false);
  const preference = usePreferencesStore();
  const weight = useWeightStore();
  const live = () => focused.current && logsDateStore.get() === date;
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; selection.clear(); onSelection(date, false); };
  }, [date, onSelection, selection.clear]));
  useEffect(() => logsDateStore.subscribe(() => {
    if (logsDateStore.get() === date) feed.current?.resetScroll();
    else selection.clear();
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
  return <View style={{ flex: 1 }}>
    {preference.preferencesReady && preference.weightTrackingEnabled ? <DailyWeightRow measurement={weight.weightsByDate[date]} disabled={date > today}
      onPress={() => { if (live()) router.push({ pathname: '/weight-entry', params: { dateId: date } }); }} /> : null}
    {weight.syncError ? <Text selectable tone="danger">{weight.syncError.message}</Text> : null}
    <StickyMacroHeader {...log} foods={log.foods} />
    <Button title={log.foods.length ? 'Detalle nutricional' : 'Sin alimentos registrados'} variant="ghost" size="md"
      onPress={() => { if (live()) router.push({ pathname: '/day-nutrition', params: { dateId: date } }); }} />
    <RecyclingHourRailFeed ref={feed} foods={log.foods} engine="legend"
      onSelectFood={openEdit} onAddAtHour={openSearch} isSelectionMode={selection.isSelectionMode} selectedFoodIds={selection.selectedIds}
      onLongPressFood={food => { if (live()) selection.startFromFood(food); }}
      onLongPressGroup={ids => { if (live()) selection.startFromGroup(ids); }}
      onToggleSelectFood={id => { if (live()) selection.toggleFood(id); }}
      onToggleSelectGroup={ids => { if (live()) selection.toggleGroup(ids); }} />
    {selection.isSelectionMode ? <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, gap: 8 }}>
      <Button title={`${selection.selectedCount} seleccionados · Cancelar`} variant="secondary" size="md" onPress={selection.clear} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Button title="Mover" size="md" style={{ flex: 1, paddingHorizontal: 6 }} onPress={() => openBatch('/batch-move')} />
        <Button title="Copiar" size="md" style={{ flex: 1, paddingHorizontal: 6 }} onPress={() => openBatch('/batch-copy')} />
        <Button title="Eliminar" size="md" variant="danger" style={{ flex: 1, paddingHorizontal: 6 }} onPress={remove} />
      </View>
    </View> : null}
  </View>;
});
