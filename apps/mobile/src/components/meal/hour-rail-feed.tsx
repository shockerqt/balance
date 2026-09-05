import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { FlatList, TouchableOpacity, View } from 'react-native';
import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { DEFAULT_HOUR_RANGE, HourRange, HourRailRow, buildHourRailRows } from '@/lib/hours';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';
import { LedgerFoodRow } from './ledger-food-row';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';

const RAIL_W = 56;
const DOT = 20;
const PAD_RIGHT = 8;
const NODE_TOP = 6;
/** Centro del punto medido desde el borde superior del slot. */
const NODE_CENTER = NODE_TOP + DOT / 2;

/**
 * El eje del riel. La linea y el punto se derivan de aqui, no se
 * calculan por separado: es lo que los mantiene centrados entre si.
 */
const AXIS = RAIL_W - PAD_RIGHT - DOT / 2;

const HourNode: React.FC<{
  hour: string;
  filled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof useStyles>;
}> = React.memo(({
  hour,
  filled,
  onPress,
  styles,
}) => {
  const label = filled ? `Agregar otro a las ${hour}` : `Registrar a las ${hour}`;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.node}
      delayPressIn={0}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={onPress}>
      <Text variant="caption" tone={filled ? 'primary' : 'muted'} style={styles.hour}>
        {hour.slice(0, 2)}
      </Text>
      <View style={[styles.dot, filled ? styles.dotFilled : styles.dotEmpty]}>
        <Text variant="caption" tone={filled ? 'onPrimary' : 'muted'}>
          +
        </Text>
      </View>
    </TouchableOpacity>
  );
});

interface FeedActions {
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtHour: (hour: string) => void;
  isSelectionMode?: boolean;
  selectedFoodIds?: ReadonlySet<string>;
  onLongPressFood?: (food: LoggedFoodItem) => void;
  onLongPressGroup?: (foodIds: string[]) => void;
  onToggleSelectFood?: (foodId: string) => void;
  onToggleSelectGroup?: (foodIds: string[]) => void;
}

const RailRow = React.memo(function RailRow({ row, isLast, ...actions }: FeedActions & {
  row: HourRailRow;
  isLast: boolean;
}) {
  const styles = useStyles();
  const showHour = row.kind !== 'food' || row.showHour;
  return (
    <View style={[styles.slot, row.kind === 'empty' && styles.slotEmpty]}>
      <View style={styles.rail}>
        <View style={styles.lineTop} />
        {!isLast && <View style={showHour ? styles.lineBottom : styles.lineFull} />}
        {showHour && (
          <View style={styles.nodeBox}>
            <HourNode hour={row.hour} filled={row.kind !== 'empty'}
              onPress={() => actions.onAddAtHour(row.hour)} styles={styles} />
          </View>
        )}
      </View>
      <View style={[styles.body, showHour && styles.hourBody]}>
        {row.kind === 'summary' && (
          <TouchableOpacity accessibilityRole="button" style={styles.summary} delayPressIn={0}
            accessibilityLabel={`Seleccionar alimentos de las ${row.hour}`}
            disabled={!actions.isSelectionMode && !actions.onLongPressGroup}
            onPress={() => actions.isSelectionMode && actions.onToggleSelectGroup?.(row.ids)}
            onLongPress={() => actions.onLongPressGroup?.(row.ids)}>
            <Text variant="caption" tone="secondary" style={styles.tabular}>
              {formatMacroGrams(row.totals.protein)} P · {formatMacroGrams(row.totals.carbs)} C · {formatMacroGrams(row.totals.fat)} G
            </Text>
            <Text variant="number">{formatCalories(row.totals.calories)}</Text>
          </TouchableOpacity>
        )}
        {row.kind === 'food' && (
          <LedgerFoodRow food={row.food}
            onPress={actions.onSelectFood} onLongPress={actions.onLongPressFood}
            isSelectionMode={actions.isSelectionMode}
            isSelected={actions.selectedFoodIds?.has(row.food.id) ?? false}
            onToggleSelect={actions.onToggleSelectFood} />
        )}
      </View>
    </View>
  );
});

const keyExtractor = (row: HourRailRow) => row.key;

export const HourRailFeed = React.memo(function HourRailFeed({
  dateId, foods, hourRange = DEFAULT_HOUR_RANGE, ...actions
}: FeedActions & { dateId: string; foods: LoggedFoodItem[]; hourRange?: HourRange }) {
  const styles = useStyles();
  const list = useRef<FlatList<HourRailRow>>(null);
  const rows = useMemo(() => buildHourRailRows(foods, hourRange), [foods, hourRange]);
  useLayoutEffect(() => { list.current?.scrollToOffset({ offset: 0, animated: false }); }, [dateId]);

  const foodIds = useMemo(() => new Set(foods.map((food) => food.id)), [foods]);
  const committed = useRef({ actions, foodIds });
  useLayoutEffect(() => { committed.current = { actions, foodIds }; });
  // Stable event adapters let unchanged hour cells skip React work. Read only
  // committed props, and reject delayed events from foods on a previous day.
  const handlers = useMemo(() => ({
    onAddAtHour: (hour: string) => committed.current.actions.onAddAtHour(hour),
    onSelectFood: (food: LoggedFoodItem) => {
      if (committed.current.foodIds.has(food.id)) committed.current.actions.onSelectFood(food);
    },
    onLongPressFood: (food: LoggedFoodItem) => {
      if (committed.current.foodIds.has(food.id)) committed.current.actions.onLongPressFood?.(food);
    },
    onLongPressGroup: (ids: string[]) => {
      if (ids.every((id) => committed.current.foodIds.has(id))) committed.current.actions.onLongPressGroup?.(ids);
    },
    onToggleSelectFood: (id: string) => {
      if (committed.current.foodIds.has(id)) committed.current.actions.onToggleSelectFood?.(id);
    },
    onToggleSelectGroup: (ids: string[]) => {
      if (ids.every((id) => committed.current.foodIds.has(id))) committed.current.actions.onToggleSelectGroup?.(ids);
    },
  }), []);

  const renderItem = useCallback(({ item, index }: { item: HourRailRow; index: number }) => (
    <RailRow row={item} isLast={index === rows.length - 1} {...handlers}
      isSelectionMode={actions.isSelectionMode} selectedFoodIds={actions.selectedFoodIds} />
  ), [rows.length, actions.isSelectionMode, actions.selectedFoodIds, handlers]);

  return (
    <FlatList ref={list} data={rows} keyExtractor={keyExtractor} renderItem={renderItem}
      contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      initialNumToRender={18} maxToRenderPerBatch={8} windowSize={3}
      updateCellsBatchingPeriod={16}
      ListHeaderComponent={foods.length === 0 ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Toca una hora para anotar lo que comiste
        </Text>
      ) : null}
    />
  );
});

const useStyles = makeStyles((t) => ({
  content: { paddingBottom: 120 },
  hint: { paddingHorizontal: t.space.lg, paddingTop: t.space.md, paddingBottom: t.space.sm },

  slot: { flexDirection: 'row' },
  slotEmpty: { minHeight: 34 },

  rail: { width: RAIL_W },
  /* Ambos cuelgan del mismo eje: por eso quedan centrados entre si. */
  lineTop: {
    position: 'absolute',
    left: AXIS - 0.5,
    top: 0,
    height: NODE_CENTER,
    width: t.border.hairline,
    backgroundColor: t.colors.border,
  },
  lineBottom: {
    position: 'absolute',
    left: AXIS - 0.5,
    top: NODE_CENTER,
    bottom: 0,
    width: t.border.hairline,
    backgroundColor: t.colors.border,
  },
  nodeBox: { position: 'absolute', right: PAD_RIGHT, top: NODE_TOP },

  node: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hour: { fontVariant: ['tabular-nums'] },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotFilled: { backgroundColor: t.colors.primary },
  dotEmpty: {
    backgroundColor: t.colors.background,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
  },

  lineFull: {
    position: 'absolute', left: AXIS - 0.5, top: 0, bottom: 0,
    width: t.border.hairline, backgroundColor: t.colors.border,
  },
  body: { flex: 1, minWidth: 0 },
  hourBody: { paddingTop: 4, minHeight: 34 },
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingBottom: 2,
  },
  tabular: { fontVariant: ['tabular-nums'] },
}));
