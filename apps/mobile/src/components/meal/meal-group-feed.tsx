import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { useReducedMotion, type SharedValue } from 'react-native-reanimated';
import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { buildMealGroups, type MealGroup } from '@/lib/meal-groups';
import { formatCalories, formatMacroGrams, sumNutrition } from '@/lib/nutrition';
import { makeStyles } from '@/theme';
import { Icon, Text } from '@/components/ui';
import type { FeedActions, HourRailFeedHandle } from './hour-rail-feed';

function macroLabel(foods: LoggedFoodItem[]) {
  const n = sumNutrition(foods);
  return `P ${formatMacroGrams(n.protein)} · C ${formatMacroGrams(n.carbs)} · G ${formatMacroGrams(n.fat)}`;
}
const keyExtractor = (group: MealGroup) => group.key;

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
      <Text variant="caption" tone="secondary" numberOfLines={1}>{food.portion}</Text>
      {showMacros ? <Text variant="caption" tone="secondary">{macroLabel([food])}</Text> : null}
    </View>
    <Text variant="number">{calories}</Text>
  </TouchableOpacity>;
});

/** One hour: header (hour, total, +) and its list card as a single cell. */
const Group = React.memo(function Group({ group, actions, selectedFoodIds, showMacros }: { group: MealGroup; actions: FeedActions; selectedFoodIds?: ReadonlySet<string>; showMacros: boolean }) {
  const styles = useStyles();
  return <View>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Comidas de las ${group.hour}, ${formatCalories(group.calories)} kilocalorías${showMacros ? `, ${macroLabel(group.foods)}` : ''}`}
        accessibilityHint={actions.isSelectionMode ? 'Selecciona o quita todas las comidas de esta hora' : 'Mantén presionado para seleccionar esta hora'}
        disabled={!actions.isSelectionMode && !actions.onLongPressGroup} delayPressIn={0} style={styles.headerLabel}
        onPress={() => actions.isSelectionMode && actions.onToggleSelectGroup?.(group.ids)}
        onLongPress={() => actions.onLongPressGroup?.(group.ids)}>
        <Text variant="hour">{group.hour}</Text>
        <Text variant="caption" tone="secondary">{formatCalories(group.calories)} kcal{showMacros ? ` · ${macroLabel(group.foods)}` : ''}</Text>
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
export const MealGroupFeed = React.memo(function MealGroupFeed({ foods, ref, empty, showMacros = false, scrollOffset, ...actions }: FeedActions & {
  showMacros?: boolean;
  scrollOffset?: SharedValue<number>;
  foods: LoggedFoodItem[];
  ref?: React.Ref<HourRailFeedHandle>;
  empty: React.ReactElement;
}) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const rawMax = Math.max(0, content - viewport);
  const runway = rawMax > 0 ? Math.max(0, 216 - rawMax) : 0;
  const snap = (offset: number) => {
    if (!scrollOffset || rawMax <= 0 || offset <= 0 || offset >= 216) return;
    list.current?.scrollToOffset({ offset: offset < 108 ? 0 : 216, animated: !reducedMotion });
  };
  const list = useRef<{ scrollToOffset: (options: { offset: number; animated: boolean }) => unknown } | null>(null);
  const attach = useCallback((value: typeof list.current) => { list.current = value; }, []);
  useImperativeHandle(ref, () => ({ resetScroll: () => { list.current?.scrollToOffset({ offset: 0, animated: false }); } }), []);
  useEffect(() => {
    if (scrollOffset && content > 0 && viewport > 0 && rawMax <= 0) {
      scrollOffset.value = 0;
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [content, viewport, rawMax, scrollOffset]);
  const groups = useMemo(() => buildMealGroups(foods), [foods]);
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
  const renderItem = useCallback(({ item }: { item: MealGroup }) =>
    <Group group={item} actions={groupActions} selectedFoodIds={actions.selectedFoodIds} showMacros={showMacros} />, [groupActions, actions.selectedFoodIds, showMacros]);
  return <AnimatedLegendList ref={attach} scrollEnabled={!scrollOffset || rawMax > 0} sharedValues={scrollOffset ? { scrollOffset } : undefined}
    onLayout={event => setViewport(event.nativeEvent.layout.height)}
    onContentSizeChange={(_width, height) => setContent(Math.max(0, height - runway))}
    onScrollEndDrag={event => { if (!event.nativeEvent.velocity?.y) snap(event.nativeEvent.contentOffset.y); }}
    onMomentumScrollEnd={event => snap(event.nativeEvent.contentOffset.y)} data={groups} renderItem={renderItem} keyExtractor={keyExtractor}
    recycleItems maintainVisibleContentPosition={false} drawDistance={250} showsVerticalScrollIndicator={false}
    ListEmptyComponent={empty} contentContainerStyle={[styles.content, scrollOffset ? { paddingTop: 336, paddingBottom: 120 + runway } : null]} />;
});

const useStyles = makeStyles((t) => ({
  content: { paddingTop: 2, paddingBottom: 120 },
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
