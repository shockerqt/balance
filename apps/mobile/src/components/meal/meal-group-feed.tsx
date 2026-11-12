import React, { useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { buildMealGroupRows, type MealGroupRow } from '@/lib/meal-groups';
import { formatCalories } from '@/lib/nutrition';
import { makeStyles } from '@/theme';
import { Icon, Text } from '@/components/ui';
import type { FeedActions, HourRailFeedHandle } from './hour-rail-feed';

const keyExtractor = (row: MealGroupRow) => row.key;
const getItemType = (row: MealGroupRow) => row.kind;

const GroupHeader = React.memo(function GroupHeader({ row, actions }: { row: Extract<MealGroupRow, { kind: 'header' }>; actions: FeedActions }) {
  const styles = useStyles();
  return <View style={styles.header}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Comidas de las ${row.hour}, ${formatCalories(row.calories)} kilocalorías`}
      accessibilityHint={actions.isSelectionMode ? 'Selecciona o quita todas las comidas de esta hora' : 'Mantén presionado para seleccionar esta hora'}
      disabled={!actions.isSelectionMode && !actions.onLongPressGroup} delayPressIn={0} style={styles.headerLabel}
      onPress={() => actions.isSelectionMode && actions.onToggleSelectGroup?.(row.ids)}
      onLongPress={() => actions.onLongPressGroup?.(row.ids)}>
      <Text variant="hour">{row.hour}</Text>
      <Text variant="caption" tone="secondary">{formatCalories(row.calories)} kcal</Text>
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Agregar a las ${row.hour}`} disabled={actions.isSelectionMode}
      delayPressIn={0} style={styles.add} onPress={() => actions.onAddAtHour(row.hour)}>
      <Icon name="plus" size={16} tone="primary" />
    </TouchableOpacity>
  </View>;
});

const FoodRow = React.memo(function FoodRow({ row, actions, selected }: { row: Extract<MealGroupRow, { kind: 'food' }>; actions: FeedActions; selected: boolean }) {
  const styles = useStyles();
  const { food } = row;
  const calories = formatCalories(food.calories);
  return <View style={[styles.cardSide, row.first && styles.cardTop, row.last && styles.cardBottom]}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${food.name}, ${food.portion}, ${calories} kilocalorías`}
      accessibilityState={{ selected: actions.isSelectionMode ? selected : undefined }} activeOpacity={0.7} delayPressIn={0}
      style={[styles.row, !row.first && styles.divider]}
      onPress={() => actions.isSelectionMode && actions.onToggleSelectFood ? actions.onToggleSelectFood(food.id) : actions.onSelectFood(food)}
      onLongPress={() => actions.onLongPressFood?.(food)}>
      {actions.isSelectionMode ? <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Icon name="check" size={14} tone="onPrimary" /> : null}
      </View> : null}
      <View style={styles.main}>
        <Text variant="bodyStrong" numberOfLines={1}>{food.name}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>{food.portion}</Text>
      </View>
      <Text variant="number">{calories}</Text>
    </TouchableOpacity>
  </View>;
});

/** Comidas del dia agrupadas por hora. Conserva la seleccion multiple y el reciclado de celdas. */
export const MealGroupFeed = React.memo(function MealGroupFeed({ foods, ref, empty, ...actions }: FeedActions & {
  foods: LoggedFoodItem[];
  ref?: React.Ref<HourRailFeedHandle>;
  /** Contenido sobre la lista: el resumen del dia, que tambien desplaza. */
  header?: React.ReactElement;
  empty: React.ReactElement;
}) {
  const styles = useStyles();
  const list = useRef<{ scrollToOffset: (options: { offset: number; animated: boolean }) => unknown } | null>(null);
  const attach = useCallback((value: typeof list.current) => { list.current = value; }, []);
  useImperativeHandle(ref, () => ({ resetScroll: () => { list.current?.scrollToOffset({ offset: 0, animated: false }); } }), []);
  const rows = useMemo(() => buildMealGroupRows(foods), [foods]);
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
  const rowActions = useMemo(() => ({ ...handlers, isSelectionMode: actions.isSelectionMode }), [handlers, actions.isSelectionMode]);
  const renderItem = useCallback(({ item }: { item: MealGroupRow }) => item.kind === 'header'
    ? <GroupHeader row={item} actions={rowActions} />
    : <FoodRow row={item} actions={rowActions} selected={actions.selectedFoodIds?.has(item.food.id) ?? false} />,
  [rowActions, actions.selectedFoodIds]);
  return <LegendList ref={attach} data={rows} renderItem={renderItem} keyExtractor={keyExtractor} getItemType={getItemType}
    recycleItems maintainVisibleContentPosition={false} drawDistance={250} showsVerticalScrollIndicator={false}
    ListHeaderComponent={actions.header} ListEmptyComponent={empty} contentContainerStyle={styles.content} />;
});

const useStyles = makeStyles((t) => ({
  content: { paddingTop: 2, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: t.space.xl, paddingTop: t.space.md, paddingBottom: 4 },
  headerLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  add: { width: 44, height: 36, borderRadius: t.radius.sm, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  cardSide: { marginHorizontal: t.space.xl, paddingHorizontal: 14, backgroundColor: t.colors.surface, borderLeftWidth: t.border.hairline, borderRightWidth: t.border.hairline, borderColor: t.colors.border },
  cardTop: { borderTopWidth: t.border.hairline, borderTopLeftRadius: t.radius.lg, borderTopRightRadius: t.radius.lg },
  cardBottom: { borderBottomWidth: t.border.hairline, borderBottomLeftRadius: t.radius.lg, borderBottomRightRadius: t.radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 48 },
  divider: { borderTopWidth: t.border.hairline, borderTopColor: t.colors.track },
  main: { flex: 1, minWidth: 0 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
}));
