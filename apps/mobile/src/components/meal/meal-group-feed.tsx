import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TouchableOpacity, View, type NativeScrollEvent, type ScrollView, type ScrollViewProps } from 'react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import type { LegendListRef } from '@legendapp/list/react-native';
import Animated, { runOnJS, runOnUI, scrollTo, useAnimatedReaction, useAnimatedRef, useEvent, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { buildMealGroups, type MealGroup } from '@/lib/meal-groups';
import { formatCalories, formatMacroGrams, sumNutrition } from '@/lib/nutrition';
import { makeStyles } from '@/theme';
import { Icon, Text } from '@/components/ui';
import type { FeedActions, HourRailFeedHandle } from './hour-rail-feed';
import { canEnterPage, snapRunway, type DiaryPagePresentation } from '@/lib/diary-presentation';
import { recordDiaryProof } from '@/dev/native-pager-status';

function macroLabel(foods: LoggedFoodItem[]) {
  const n = sumNutrition(foods);
  return `P ${formatMacroGrams(n.protein)} · C ${formatMacroGrams(n.carbs)} · G ${formatMacroGrams(n.fat)}`;
}
const keyExtractor = (group: MealGroup) => group.key;

// Explicit event names register a UI observer. Ordinary native JS callbacks are
// spread afterwards so Reanimated's PropsFilter retains Legend's real onScroll.
const DiaryScrollHost = React.forwardRef<ScrollView, ScrollViewProps & { observation: unknown }>(function DiaryScrollHost({ observation, ...props }, ref) {
  return <Animated.ScrollView {...{ diaryScrollObservation: observation }} {...props} ref={ref} />;
});

const FoodRow = React.memo(function FoodRow({ food, first, actions, selected, showMacros }: { food: LoggedFoodItem; first: boolean; actions: FeedActions; selected: boolean; showMacros: boolean }) {
  const styles = useStyles();
  const calories = formatCalories(food.calories);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${food.name}, ${food.portion}, ${calories} kilocalorías${showMacros ? `, ${macroLabel([food])}` : ''}`}
    accessibilityState={{ selected: actions.isSelectionMode ? selected : undefined }} activeOpacity={0.7} delayPressIn={0}
    style={[styles.row, !first && styles.divider]}
    onPress={() => actions.isSelectionMode && actions.onToggleSelectFood ? actions.onToggleSelectFood(food.id) : actions.onSelectFood(food)}
    onLongPress={() => actions.onLongPressFood?.(food)}>
    {actions.isSelectionMode ? <View style={[styles.check, selected && styles.checkOn]}>
      {selected ? <Icon name="check" size={14} tone="onPrimary" /> : null}
    </View> : null}
    <View style={styles.main}>
      <Text variant="bodyStrong" numberOfLines={1}>{food.name}</Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>{food.portion}{showMacros ? ` · ${formatMacroGrams(food.protein)}P · ${formatMacroGrams(food.carbs)}C · ${formatMacroGrams(food.fat)}G` : ''}</Text>
    </View>
    <Text variant="number">{calories}</Text>
  </TouchableOpacity>;
});

/** One hour: header (hour, total, +) and its list card as a single cell. */
type CommitGroup = (key: string, group: MealGroup, view: View | null) => void;
const Group = React.memo(function Group({ group, first, actions, selectedFoodIds, showMacros, onCommit }: { group: MealGroup; first: boolean; actions: FeedActions; selectedFoodIds?: ReadonlySet<string>; showMacros: boolean; onCommit?: CommitGroup }) {
  const styles = useStyles();
  const native = useRef<View>(null);
  useLayoutEffect(() => { onCommit?.(group.key, group, native.current); return () => onCommit?.(group.key, group, null); }, [group, onCommit]);
  return <View ref={native}>
    <View style={[styles.header, first && { paddingTop: 0 }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Comidas de las ${group.hour}, ${formatCalories(group.calories)} kilocalorías${showMacros ? `, ${macroLabel(group.foods)}` : ''}`}
        accessibilityHint={actions.isSelectionMode ? 'Selecciona o quita todas las comidas de esta hora' : 'Mantén presionado para seleccionar esta hora'}
        disabled={!actions.isSelectionMode && !actions.onLongPressGroup} delayPressIn={0} style={styles.headerLabel}
        onPress={() => actions.isSelectionMode && actions.onToggleSelectGroup?.(group.ids)}
        onLongPress={() => actions.onLongPressGroup?.(group.ids)}>
        <Text variant="hour">{group.hour}</Text>
        <Text variant="caption" tone="secondary">{formatCalories(group.calories)} kcal</Text>
        {showMacros ? <Text variant="label" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{macroLabel(group.foods)}</Text> : null}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Agregar a las ${group.hour}`} disabled={actions.isSelectionMode}
        delayPressIn={0} style={styles.add} onPress={() => actions.onAddAtHour(group.hour)}>
        <Icon name="plus" size={16} tone="primary" />
      </TouchableOpacity>
    </View>
    <View style={styles.card}>
      {group.foods.map((food, index) => <FoodRow key={food.id} food={food} first={index === 0} actions={actions} showMacros={showMacros}
        selected={selectedFoodIds?.has(food.id) ?? false} />)}
    </View>
  </View>;
});

/** Comidas del dia agrupadas por hora. Conserva la seleccion multiple y el reciclado de celdas. */
export const MealGroupFeed = React.memo(function MealGroupFeed({ foods, ref, empty, showMacros = false, scrollOffset,
  presentation, dayNumber = 0, prefix = 336, collapseDistance = 216, headerReady = false, ...actions }: FeedActions & {
  showMacros?: boolean;
  scrollOffset?: SharedValue<number>;
  foods: LoggedFoodItem[];
  ref?: React.Ref<HourRailFeedHandle>;
  empty: React.ReactElement;
  presentation?: DiaryPagePresentation;
  dayNumber?: number;
  prefix?: number;
  collapseDistance?: number;
  headerReady?: boolean;
}) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [emptyHeight, setEmptyHeight] = useState(0);
  const baseContent = presentation ? (foods.length ? content : prefix + emptyHeight + 16) : content;
  const rawMax = Math.max(0, baseContent - viewport);
  const runway = viewport > 0 ? snapRunway(baseContent, viewport, collapseDistance) : 0;
  const nativeRef = useAnimatedRef<ScrollView>();
  const connected = useSharedValue(false);
  const offset = scrollOffset;
  const reset = useSharedValue({ serial: 0, handled: -1, pending: false, moved: false, observedZero: false });
  const [receiptVersion, setReceiptVersion] = useState(0);
  const committed = useRef(new Map<string, { group: MealGroup; view: View }>());
  const emptyView = useRef<View>(null);
  const mounted = useRef(true);
  const scheduled = useRef(false);
  const evaluate = useRef<() => void>(() => {});
  const queueEvaluation = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => { scheduled.current = false; if (mounted.current) setReceiptVersion(value => value + 1); });
  }, []);
  const snap = (offset: number) => {
    if (!scrollOffset || rawMax <= 0 || offset <= 0 || offset >= collapseDistance) return;
    if (presentation) {
      runOnUI((target: number, animated: boolean) => {
        'worklet';
        if (!connected.value || !presentation.motion.value.enabled || presentation.motion.value.visual !== dayNumber || presentation.motion.value.phase !== 0) return;
        reset.value = { ...reset.value, moved: true, observedZero: false };
        scrollTo(nativeRef, 0, target, animated);
      })(offset < collapseDistance / 2 ? 0 : collapseDistance, !reducedMotion);
    } else list.current?.scrollToOffset({ offset: offset < collapseDistance / 2 ? 0 : collapseDistance, animated: !reducedMotion });
  };
  const list = useRef<LegendListRef | null>(null);
  const nativeInstance = useRef<unknown>(null);
  const attachNative = useCallback((value: ScrollView | null) => {
    nativeRef(value);
    connected.value = value !== null;
    if (value !== null && nativeInstance.current !== value) {
      nativeInstance.current = value;
      reset.value = { serial: 0, handled: -1, pending: false, moved: false, observedZero: false };
    }
    queueEvaluation();
  }, [connected, nativeRef, queueEvaluation, reset]);
  const attach = useCallback((value: LegendListRef | null) => { list.current = value; queueEvaluation(); }, [queueEvaluation]);
  useImperativeHandle(ref, () => ({ resetScroll: () => { list.current?.scrollToOffset({ offset: 0, animated: false }); } }), []);
  useEffect(() => {
    if (!presentation && scrollOffset && content > 0 && viewport > 0 && rawMax <= 0) {
      scrollOffset.value = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [content, viewport, rawMax, scrollOffset, presentation]);
  const groups = useMemo(() => buildMealGroups(foods), [foods]);
  const layoutToken = useMemo(() => ({ groups, prefix, viewport, headerReady }), [groups, prefix, viewport, headerReady]);
  const latestLayout = useRef(layoutToken);
  latestLayout.current = layoutToken;
  const appliedRunway = useRef(runway);
  const currentGroups = useRef(groups);
  currentGroups.current = groups;
  const jsZeroSerial = useRef(0);
  const registerGroup = useCallback<CommitGroup>((key, group, view) => {
    if (view) committed.current.set(key, { group, view });
    else if (committed.current.get(key)?.group === group) committed.current.delete(key);
    if (presentation && presentation.ready.value[String(dayNumber)] !== true) queueEvaluation();
  }, [dayNumber, presentation, queueEvaluation]);
  const publishReady = useCallback((ready: boolean, serial: number, instance: unknown) => {
    if (!presentation) return;
    // The native instance is checked on JS before publishing; UI then checks
    // surface lifetime, cleanup serial and current native offset again.
    if (nativeInstance.current !== instance) return;
    runOnUI((next: boolean, expected: number) => {
      'worklet';
      if (!presentation.motion.value.enabled || reset.value.serial !== expected || !connected.value) return;
      if (next && presentation.motion.value.visual !== dayNumber && (!offset || Math.abs(offset.value) > 1 || reset.value.pending)) return;
      if (presentation.ready.value[String(dayNumber)] !== next)
        presentation.ready.value = { ...presentation.ready.value, [String(dayNumber)]: next };
    })(ready, serial);
  }, [connected, dayNumber, offset, presentation, reset]);
  const adoptNoopZero = useCallback((serial: number) => {
    if (reset.value.serial === serial && offset && Math.abs(offset.value) <= 1 && Math.abs(list.current?.getState().scroll ?? Infinity) <= 1) {
      jsZeroSerial.current = serial;
      queueEvaluation();
    }
  }, [offset, queueEvaluation, reset]);
  const observation = useEvent<NativeScrollEvent>(event => {
    'worklet';
    if (!presentation || !presentation.motion.value.enabled || !offset) return;
    const y = Math.max(0, event.contentOffset.y);
    offset.value = y;
    reset.value = { ...reset.value, moved: reset.value.moved || y > 1,
      observedZero: y <= 1, pending: y <= 1 ? false : reset.value.pending };
    if (presentation.motion.value.visual !== dayNumber && y > 1 && presentation.ready.value[String(dayNumber)] === true)
      presentation.ready.value = { ...presentation.ready.value, [String(dayNumber)]: false };
  }, ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollEnd']);
  const renderScrollComponent = useCallback((props: ScrollViewProps) => <DiaryScrollHost {...props} observation={observation} />, [observation]);
  useAnimatedReaction(() => presentation ? {
    serial: presentation.motion.value.serial, cleanup: presentation.motion.value.cleanup,
    position: presentation.motion.value.position, phase: presentation.motion.value.phase,
    enabled: presentation.motion.value.enabled, connected: connected.value,
  } : null, next => {
    if (!next || !next.enabled || !next.connected || next.cleanup !== dayNumber || next.phase !== 0
      || Math.abs(next.position - dayNumber) < 0.999 || reset.value.handled === next.serial || !offset) return;
    const previous = reset.value;
    const serial = previous.serial + 1;
    reset.value = { ...previous, handled: next.serial, serial, pending: Math.abs(offset.value) > 1 };
    if (presentation) presentation.ready.value = { ...presentation.ready.value, [String(dayNumber)]: false };
    if (Math.abs(offset.value) > 1) scrollTo(nativeRef, 0, 0, false);
    else if (!previous.moved || previous.observedZero) runOnJS(adoptNoopZero)(serial);
  });
  useLayoutEffect(() => {
    appliedRunway.current = runway;
    queueEvaluation();
  }, [groups, headerReady, prefix, queueEvaluation, runway, viewport]);
  useEffect(() => {
    mounted.current = true;
    const state = list.current?.getState();
    const unsubscribe = state ? ['totalSize', 'headerSize', 'readyToRender', 'lastPositionUpdate'].map(signal =>
      state.listen(signal as 'totalSize', queueEvaluation)) : [];
    queueEvaluation();
    return () => {
      mounted.current = false;
      unsubscribe.forEach(stop => stop());
      if (presentation) runOnUI(() => {
        'worklet';
        presentation.ready.value = { ...presentation.ready.value, [String(dayNumber)]: false };
      })();
    };
  }, [dayNumber, presentation, queueEvaluation]);
  evaluate.current = () => {
    const handle = list.current;
    if (!handle || typeof handle.getState !== 'function') return;
    const state = handle.getState();
    if (foods.length) {
      const base = Math.max(0, state.contentLength - appliedRunway.current);
      setContent(previous => previous === base ? previous : base);
    }
    if (!presentation) return;
    const serial = reset.value.serial, instance = nativeInstance.current, token = latestLayout.current;
    const current = presentation.motion.value;
    const nativeY = offset?.value ?? Infinity;
    const isCurrent = current.visual === dayNumber;
    const nativeZero = Math.abs(nativeY) <= 1 && !reset.value.pending && (!reset.value.moved || reset.value.observedZero);
    const coreZero = Math.abs(state.scroll) <= 1 && (jsZeroSerial.current === serial || !reset.value.moved);
    const trace = (stage: 'waiting' | 'native' | 'core' | 'range' | 'ready', required = 0, measured = 0) => recordDiaryProof({
      stage, surface: current.surface, serial, slot: dayNumber - current.visual,
      nativeOffset: nativeY, coreOffset: state.scroll, viewport, prefix, required, measured,
    });
    if (!headerReady || !connected.value || viewport <= 0 || (!isCurrent && (!nativeZero || !coreZero))) {
      trace(nativeZero ? 'native' : 'waiting'); publishReady(false, serial, instance); return;
    }
    const expectedGroups = currentGroups.current;
    const views: Array<{ view: View; top: number; group?: MealGroup }> = [];
    if (expectedGroups.length === 0) {
      if (emptyView.current && emptyHeight > 0) views.push({ view: emptyView.current, top: prefix });
    } else {
      if (state.start < 0 || state.end < state.start) { publishReady(false, serial, instance); return; }
      for (let index = state.start; index <= state.end; index++) {
        const group = expectedGroups[index], receipt = group && committed.current.get(group.key);
        const position = state.positionAtIndex(index);
        if (!group || !receipt || receipt.group !== group || !Number.isFinite(position) || !state.elementAtIndex(index)) {
          publishReady(false, serial, instance); return;
        }
        views.push({ view: receipt.view, top: prefix + position, group });
      }
    }
    if (!views.length || !nativeRef.current) { publishReady(false, serial, instance); return; }
    let left = views.length, valid = true;
    const expectedNative = nativeY;
    nativeRef.current.getNativeScrollRef()?.measure((_x, _y, width, height, _pageX, viewportTop) => {
      if (width <= 0 || height <= 0) { publishReady(false, serial, instance); return; }
      for (const receipt of views) receipt.view.measure((_vx, _vy, viewWidth, viewHeight, _viewX, top) => {
        valid = valid && viewWidth > 0 && viewHeight > 0 && Math.abs(top - viewportTop - receipt.top + expectedNative) <= 1;
        left--;
        if (left !== 0) return;
        const latest = handle.getState();
        const stillCurrent = mounted.current && nativeInstance.current === instance && reset.value.serial === serial && latestLayout.current === token
          && currentGroups.current === expectedGroups && latest.start === state.start && latest.end === state.end
          && Math.abs(latest.scroll - state.scroll) <= 1 && Math.abs((offset?.value ?? Infinity) - expectedNative) <= 1;
        const ready = isCurrent
          ? stillCurrent && valid && Math.abs(latest.scroll - expectedNative) <= 1
          : canEnterPage({ connected: connected.value, current: stillCurrent, header: headerReady,
            nativeZero, coreZero, committedRange: true, measuredRange: valid });
        trace(ready ? 'ready' : 'range', views.length, valid ? views.length : 0);
        publishReady(ready, serial, instance);
      });
    });
  };
  useLayoutEffect(() => { evaluate.current(); }, [receiptVersion]);
  const onNativeScroll = useCallback((event: { nativeEvent: NativeScrollEvent }) => {
    if (!presentation) return;
    if (Math.abs(event.nativeEvent.contentOffset.y) <= 1 && reset.value.observedZero) jsZeroSerial.current = reset.value.serial;
    if (presentation.ready.value[String(dayNumber)] !== true) queueEvaluation();
  }, [dayNumber, presentation, queueEvaluation, reset]);
  const foodIds = useMemo(() => new Set(foods.map(food => food.id)), [foods]);
  const live = useRef({ actions, foodIds });
  live.current = { actions, foodIds };
  // Stable adapters reject delayed events from foods that are no longer on this day.
  const handlers: FeedActions = useMemo(() => ({
    onAddAtHour: hour => live.current.actions.onAddAtHour(hour),
    onSelectFood: food => { if (live.current.foodIds.has(food.id)) live.current.actions.onSelectFood(food); },
    onLongPressFood: food => { if (live.current.foodIds.has(food.id)) live.current.actions.onLongPressFood?.(food); },
    onLongPressGroup: ids => { if (ids.every(id => live.current.foodIds.has(id))) live.current.actions.onLongPressGroup?.(ids); },
    onToggleSelectFood: id => { if (live.current.foodIds.has(id)) live.current.actions.onToggleSelectFood?.(id); },
    onToggleSelectGroup: ids => { if (ids.every(id => live.current.foodIds.has(id))) live.current.actions.onToggleSelectGroup?.(ids); },
  }), []);
  const groupActions = useMemo(() => ({ ...handlers, isSelectionMode: actions.isSelectionMode }), [handlers, actions.isSelectionMode]);
  const renderItem = useCallback(({ item, index }: { item: MealGroup; index: number }) =>
    <Group group={item} first={index === 0} actions={groupActions} selectedFoodIds={actions.selectedFoodIds} showMacros={showMacros}
      onCommit={registerGroup} />, [groupActions, actions.selectedFoodIds, showMacros, registerGroup]);
  const prefixNode = useMemo(() => <View style={{ height: prefix }} />, [prefix]);
  const emptyNode = <View ref={emptyView} onLayout={event => {
    setEmptyHeight(event.nativeEvent.layout.height); queueEvaluation();
  }}>{empty}</View>;
  return <AnimatedLegendList ref={attach} refScrollView={presentation ? attachNative : undefined}
    renderScrollComponent={presentation ? renderScrollComponent : undefined}
    initialScrollOffset={0} estimatedHeaderSize={scrollOffset ? prefix : 0}
    scrollEnabled={!scrollOffset || (viewport > 0 && rawMax > 0)} sharedValues={!presentation && scrollOffset ? { scrollOffset } : undefined}
    onLayout={event => setViewport(event.nativeEvent.layout.height)}
    onContentSizeChange={(_width, height) => { if (list.current?.getState) queueEvaluation(); else setContent(Math.max(0, height - runway)); }}
    onScroll={onNativeScroll} onScrollBeginDrag={onNativeScroll} onReady={queueEvaluation}
    onScrollEndDrag={event => { if (!event.nativeEvent.velocity?.y) snap(event.nativeEvent.contentOffset.y); }}
    onMomentumScrollEnd={event => snap(event.nativeEvent.contentOffset.y)} data={groups} renderItem={renderItem} keyExtractor={keyExtractor}
    recycleItems maintainVisibleContentPosition={false} drawDistance={250} showsVerticalScrollIndicator={false}
    ListHeaderComponent={scrollOffset ? prefixNode : undefined}
    ListEmptyComponent={foods.length ? undefined : emptyNode}
    contentContainerStyle={[styles.content, scrollOffset ? { paddingTop: 0, paddingBottom: 16 + runway } : null]} />;
});

const useStyles = makeStyles((t) => ({
  content: { paddingTop: 2, paddingBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: t.space.xl, paddingTop: t.space.md, paddingBottom: 4 },
  headerLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  add: { width: 44, height: 36, borderRadius: t.radius.sm, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  card: { marginHorizontal: t.space.xl, paddingHorizontal: 14, backgroundColor: t.colors.surface, borderWidth: t.border.hairline, borderColor: t.colors.border, borderRadius: t.radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 48 },
  divider: { borderTopWidth: t.border.hairline, borderTopColor: t.colors.track },
  main: { flex: 1, minWidth: 0 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
}));
