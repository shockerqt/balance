import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useIsFocused } from 'expo-router/react-navigation';
import Animated, { useAnimatedStyle, useAnimatedReaction, runOnJS, type SharedValue, useSharedValue } from 'react-native-reanimated';
import { Button, Card, Text } from '@/components/ui';
import { useMealActions, useMealDay, useMealHydrated, useMealStore, type LoggedFoodItem } from '@/hooks/use-meal-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useFoodSelection, type FoodSelection } from '@/hooks/use-food-selection';
import { logsDateStore, useLogsDateRevision, useLogsSelectedDate } from '@/hooks/use-logs-date';
import { currentTimeString, dateIdToEpochDay, todayId } from '@/lib/dates';
import { DateStripHeader } from './date-strip-header';
import { StickyMacroHeader } from './sticky-macro-header';
import { NativeDayWindow } from './native-day-window';
import { MealGroupFeed } from './meal-group-feed';
import type { HourRailFeedHandle } from './hour-rail-feed';
import { prepareSelectionCopy, selectionCopyPlanIsCurrent, type SelectionCopyPlan } from './native/copy-selection-contract';

/** Source snapshot of a diary-level copy: the IDs and the revisions seen when copying. */
type CopyClipboard = { sourceDate: string; ids: string[]; revisions: Record<string, number> };

export function ReactNativeDiary({ today = todayId(), active: tabActive = true }: { today?: string; active?: boolean }) {
  const routeFocused = useIsFocused();
  const active = routeFocused && tabActive;
  const [date, setDate] = useLogsSelectedDate();
  const revision = useLogsDateRevision();
  const preference = usePreferencesStore();
  const targetCalories = preference.dailyCalorieTarget ?? 2200;
  const showMacros = preference.diaryMacrosEnabled === true;
  const [lockedDate, setLockedDate] = useState<string | null>(null);
  // Lives as long as the diary, so the copied foods can be pasted on several days.
  const [clipboard, setClipboard] = useState<CopyClipboard | null>(null);
  const closeClipboard = useCallback(() => setClipboard(null), []);
  const headerScroll = useSharedValue(0);
  const activeDay = useSharedValue(dateIdToEpochDay(date));
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => { activeDay.value = dateIdToEpochDay(date); headerScroll.value = 0; setCompact(false); }, [date, revision, activeDay, headerScroll]);
  useAnimatedReaction(() => headerScroll.value >= 108, (next, prev) => { if (next !== prev) runOnJS(setCompact)(next); });
  const headerStyle = useAnimatedStyle(() => ({ height: 136 - 58 * Math.min(1, Math.max(0, headerScroll.value / 216)) }));
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
  const renderDay = useCallback(
    (day: string) => (
      <DiaryDay
        date={day}
        today={today}
        targetCalories={targetCalories}
        showMacros={showMacros}
        onSelection={selectionChanged}
        onClipboard={setClipboard}
        headerScroll={headerScroll}
        activeDay={activeDay}
      />
    ),
    [selectionChanged, setClipboard, today, targetCalories, showMacros, headerScroll, activeDay]
  );
  return <View style={{ flex: 1 }}>
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, overflow: 'hidden' }, headerStyle]}>
    <DateStripHeader compact={compact} collapseScroll={headerScroll} selectedDateId={date} onSelectDate={setDate} onShiftDate={logsDateStore.shift} pagerPosition={position} pagerInteraction={interaction} active={active} />
    </Animated.View>
    <NativeDayWindow dateId={date} revision={revision} readRevision={logsDateStore.getRevision}
      active={active} scrollEnabled={lockedDate !== date} position={position} interaction={interaction} onSettle={settle} renderDay={renderDay} />
    {clipboard && lockedDate !== date ? <ClipboardBar clipboard={clipboard} date={date} onClose={closeClipboard} /> : null}
  </View>;
}

const DiaryDay = React.memo(function DiaryDay({
  date,
  today,
  targetCalories,
  showMacros,
  onSelection,
  onClipboard,
  headerScroll,
  activeDay,
}: {
  date: string;
  today: string;
  targetCalories: number;
  showMacros: boolean;
  headerScroll: SharedValue<number>;
  activeDay: SharedValue<number>;
  onSelection: (date: string, selected: boolean) => void;
  onClipboard: (clipboard: CopyClipboard) => void;
}) {
  const router = useRouter();
  const scrollOffset = useSharedValue(0);
  const dayNumber = dateIdToEpochDay(date);
  const [compact, setCompact] = useState(false);
  useAnimatedReaction(() => ({ offset: scrollOffset.value, day: activeDay.value }), (next) => {
    if (next.day === dayNumber) headerScroll.value = Math.max(0, next.offset);
  });
  useAnimatedReaction(() => scrollOffset.value > 0, (next, prev) => { if (next !== prev) runOnJS(setCompact)(next); });
  const expandedSummaryStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - scrollOffset.value / 72) }));
  const compactSummaryStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (scrollOffset.value - 54) / 162)) }));
  const summaryStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, scrollOffset.value / 216));
    return { top: 136 - 58 * p, height: 188 - 158 * p };
  });
  const log = useMealDay(date);
  const hydrated = useMealHydrated();
  const currentLog = useRef(log);
  useLayoutEffect(() => { currentLog.current = log; }, [log]);
  const { deleteMultipleFoods } = useMealActions();
  const selection = useFoodSelection(date);
  const feed = useRef<HourRailFeedHandle>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    scrollOffset.value = 0;
    setCompact(false);
    feed.current?.resetScroll();
  }, [date, scrollOffset]);
  const live = () => focused.current && logsDateStore.get() === date;
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; selection.clear(); onSelection(date, false); };
  }, [date, onSelection, selection.clear]));
  useEffect(() => logsDateStore.subscribe(() => {
    if (logsDateStore.get() === date) { scrollOffset.value = 0; setCompact(false); feed.current?.resetScroll(); }
    else selection.clear();
  }), [date, selection.clear, scrollOffset]);
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
  const openBatch = (pathname: '/batch-move') => {
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
  if (!hydrated) {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Cargando registros del día"
        accessibilityState={{ busy: true }}
        style={{ flex: 1, paddingTop: 136, paddingHorizontal: 20, gap: 14 }}
      >
        <Card padding="md" style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <Card raised padding="none" bordered={false} radius="sm" style={{ width: 96, height: 28 }} />
            <Card raised padding="none" bordered={false} radius="sm" style={{ width: 72, height: 20 }} />
          </View>
          <Card raised padding="none" bordered={false} radius="pill" style={{ height: 10, width: '100%' }} />
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <Card raised padding="none" bordered={false} radius="sm" style={{ flex: 1, height: 34 }} />
            <Card raised padding="none" bordered={false} radius="sm" style={{ flex: 1, height: 34 }} />
            <Card raised padding="none" bordered={false} radius="sm" style={{ flex: 1, height: 34 }} />
          </View>
        </Card>
        <Card padding="md" style={{ gap: 10 }}>
          <Card raised padding="none" bordered={false} radius="sm" style={{ width: '42%', height: 14 }} />
          <Card raised padding="none" bordered={false} radius="sm" style={{ width: '85%', height: 18 }} />
          <Card raised padding="none" bordered={false} radius="sm" style={{ width: '68%', height: 14 }} />
        </Card>
        <Card padding="md" style={{ gap: 10 }}>
          <Card raised padding="none" bordered={false} radius="sm" style={{ width: '36%', height: 14 }} />
          <Card raised padding="none" bordered={false} radius="sm" style={{ width: '78%', height: 18 }} />
        </Card>
      </View>
    );
  }
  return <View style={{ flex: 1 }}>
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, zIndex: 4, overflow: 'hidden' }, summaryStyle]}>
    <Animated.View pointerEvents={compact ? 'none' : 'auto'} accessibilityElementsHidden={compact}
      importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'} style={expandedSummaryStyle}>
      <StickyMacroHeader {...log} targetCalories={targetCalories} foods={log.foods}
        onPress={() => { if (live() && !selection.isSelectionMode) router.push({ pathname: '/day-nutrition', params: { dateId: date } }); }} />
    </Animated.View>
    <Animated.View pointerEvents={compact ? 'auto' : 'none'} accessibilityElementsHidden={!compact}
      importantForAccessibility={compact ? 'auto' : 'no-hide-descendants'}
      style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, compactSummaryStyle]}>
      <StickyMacroHeader compact {...log} targetCalories={targetCalories} foods={log.foods}
        onPress={() => { if (live() && !selection.isSelectionMode) router.push({ pathname: '/day-nutrition', params: { dateId: date } }); }} />
    </Animated.View>
    </Animated.View>
    <MealGroupFeed scrollOffset={scrollOffset} showMacros={showMacros} ref={feed} foods={log.foods} empty={empty}
      onSelectFood={openEdit} onAddAtHour={openSearch} isSelectionMode={selection.isSelectionMode} selectedFoodIds={selection.selectedIds}
      onLongPressFood={food => { if (live()) selection.startFromFood(food); }}
      onLongPressGroup={ids => { if (live()) selection.startFromGroup(ids); }}
      onToggleSelectFood={id => { if (live()) selection.toggleFood(id); }}
      onToggleSelectGroup={ids => { if (live()) selection.toggleGroup(ids); }} />
    {selection.isSelectionMode ? <SelectionBar date={date} today={today} selection={selection} live={live}
      onMove={() => openBatch('/batch-move')} onRemove={remove} onClipboard={onClipboard} /> : null}
  </View>;
});

const barStyle = { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingVertical: 12, gap: 8 } as const;
const barRowStyle = { flexDirection: 'row', gap: 6 } as const;
const barButtonStyle = { flex: 1, paddingHorizontal: 6 } as const;

/* Mounted only while a selection or the clipboard is visible, so the full
   document subscription never re-renders the diary pages. */
function useSelectionPaste() {
  const { mealDocuments } = useMealStore();
  const { registerMealLogs } = useMealActions();
  const documents = useRef(mealDocuments);
  useLayoutEffect(() => { documents.current = mealDocuments; }, [mealDocuments]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  // One frozen plan per intention (source, revisions and destination). Retrying
  // after a failed receipt keeps its IDs; a different intention never replays it.
  const frozen = useRef<{ key: string; plan: SelectionCopyPlan } | null>(null);
  const revisionsOf = (ids: string[]) => {
    const byId = new Map(documents.current.map(doc => [doc.id, doc]));
    return Object.fromEntries(ids.flatMap(id => { const doc = byId.get(id); return doc ? [[id, doc.updatedAt]] : []; }));
  };
  const paste = async (source: CopyClipboard, destinationDate: string): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true; setBusy(true);
    try {
      const key = JSON.stringify([source.sourceDate, source.ids, source.revisions, destinationDate]);
      let plan: SelectionCopyPlan;
      try {
        if (frozen.current?.key === key) {
          if (!selectionCopyPlanIsCurrent(frozen.current.plan, documents.current))
            throw new Error('Los registros cambiaron. Vuelve a seleccionarlos antes de copiar.');
        } else {
          frozen.current = { key, plan: prepareSelectionCopy({ ...source, operationId: randomUUID(), destinationDate }, documents.current, randomUUID) };
        }
        plan = frozen.current.plan;
      } catch (error) {
        frozen.current = null;
        Alert.alert('No se pudo copiar', error instanceof Error ? error.message : 'Revisa los datos.');
        return false;
      }
      try { await registerMealLogs(plan.documents); } catch {
        Alert.alert('No se pudo copiar', 'No se pudo guardar en el teléfono. Conservamos los datos para que puedas reintentar.');
        return false;
      }
      // Completed: the next paste, even on the same day, is a new intention.
      frozen.current = null;
      return true;
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { saving: busy, paste, revisionsOf };
}

function SelectionBar({ date, today, selection, live, onMove, onRemove, onClipboard }: {
  date: string;
  today: string;
  selection: FoodSelection;
  live: () => boolean;
  onMove: () => void;
  onRemove: () => void;
  onClipboard: (clipboard: CopyClipboard) => void;
}) {
  const copies = useSelectionPaste();
  const capture = (): CopyClipboard | null => {
    if (!live() || !selection.selectedCount) return null;
    const ids = Array.from(selection.selectedIds);
    return { sourceDate: date, ids, revisions: copies.revisionsOf(ids) };
  };
  const copy = () => {
    const clipboard = capture();
    if (!clipboard) return;
    onClipboard(clipboard);
    // Clearing the selection unlocks day paging so the user can paste elsewhere.
    selection.clear();
  };
  const copyToToday = async () => {
    const clipboard = capture();
    if (clipboard && await copies.paste(clipboard, today)) { selection.clear(); logsDateStore.set(today); }
  };
  return <View style={barStyle}>
    <Button title={`${selection.selectedCount} seleccionados · Cancelar`} variant="secondary" size="md" onPress={selection.clear} />
    {date !== today ? <Button title="Copiar a Hoy" variant="secondary" size="md" loading={copies.saving} onPress={copyToToday} /> : null}
    <View style={barRowStyle}>
      <Button title="Mover" size="md" style={barButtonStyle} onPress={onMove} />
      <Button title="Copiar" size="md" style={barButtonStyle} onPress={copy} />
      <Button title="Eliminar" size="md" variant="danger" style={barButtonStyle} onPress={onRemove} />
    </View>
  </View>;
}

function ClipboardBar({ clipboard, date, onClose }: { clipboard: CopyClipboard; date: string; onClose: () => void }) {
  const router = useRouter();
  const copies = useSelectionPaste();
  const toDate = () => {
    if (copies.saving) return;
    router.push({ pathname: '/batch-copy', params: { dateId: clipboard.sourceDate, ids: clipboard.ids.join(','), revisions: JSON.stringify(clipboard.revisions) } });
    onClose();
  };
  // Stays open after pasting so the same foods can be pasted on several days.
  return <View style={barStyle}>
    <Button title={`${clipboard.ids.length} copiados · Cancelar`} variant="secondary" size="md" disabled={copies.saving} onPress={onClose} />
    <View style={barRowStyle}>
      <Button title="Pegar aquí" size="md" style={barButtonStyle} loading={copies.saving} onPress={() => { void copies.paste(clipboard, date); }} />
      <Button title="A fecha…" size="md" variant="secondary" style={barButtonStyle} disabled={copies.saving} onPress={toDate} />
    </View>
  </View>;
}
