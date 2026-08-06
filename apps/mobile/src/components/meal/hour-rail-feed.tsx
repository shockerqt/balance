import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { buildHourRail, sumFoods } from '@/lib/hours';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';
import { LedgerFoodRow } from './ledger-food-row';

/* ============================================================
   Riel de horas.

   Una sola regla, sin casos especiales: cada hora entre el primer y
   el ultimo registro es un nodo. Lleno si tiene comida, apagado si
   no, y todos son tocables. Tocar un nodo registra a esa hora, tenga
   o no algo ya.

   Asi "agregar a una hora que ya existe" deja de ser un boton aparte
   perdido entre las filas y pasa a ser el mismo gesto que agregar en
   una hora vacia.
   ============================================================ */

const RAIL_W = 54;
const DOT = 20;

const HourNode: React.FC<{ hour: string; filled: boolean; onPress: () => void }> = ({
  hour,
  filled,
  onPress,
}) => {
  const styles = useStyles();
  const label = filled ? `Agregar otro a las ${hour}` : `Registrar a las ${hour}`;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.node}
      delayPressIn={0}
      hitSlop={10}
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
};

export const HourRailFeed: React.FC<{
  foods: LoggedFoodItem[];
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtHour: (hour: string) => void;
  isSelectionMode?: boolean;
  selectedFoodIds?: ReadonlySet<string>;
  onLongPressFood?: (food: LoggedFoodItem) => void;
  onLongPressGroup?: (foodIds: string[]) => void;
  onToggleSelectFood?: (foodId: string) => void;
  onToggleSelectGroup?: (foodIds: string[]) => void;
}> = ({
  foods,
  onSelectFood,
  onAddAtHour,
  isSelectionMode = false,
  selectedFoodIds,
  onLongPressFood,
  onLongPressGroup,
  onToggleSelectFood,
  onToggleSelectGroup,
}) => {
  const styles = useStyles();
  const rail = useMemo(() => buildHourRail(foods), [foods]);

  if (!rail.length) {
    return (
      <View style={styles.empty}>
        <Text variant="heading">Sin registros para este día</Text>
        <Text variant="body" tone="secondary" style={styles.emptyText}>
          Toca el botón de registrar para anotar lo primero que comiste.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {rail.map(({ hour, foods: hourFoods }) => {
        const filled = hourFoods.length > 0;
        const ids = hourFoods.map((f) => f.id);
        const totals = filled ? sumFoods(hourFoods) : null;

        return (
          <View key={hour} style={[styles.slot, !filled && styles.slotEmpty]}>
            <View style={styles.rail}>
              <View style={styles.line} />
              <HourNode hour={hour} filled={filled} onPress={() => onAddAtHour(hour)} />
            </View>

            <View style={styles.body}>
              {filled && totals ? (
                <>
                  {/* Titular del grupo: se lee antes que el detalle */}
                  {hourFoods.length > 1 ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      style={styles.summary}
                      delayPressIn={0}
                      disabled={!isSelectionMode && !onLongPressGroup}
                      onPress={() => isSelectionMode && onToggleSelectGroup?.(ids)}
                      onLongPress={() => onLongPressGroup?.(ids)}>
                      <Text variant="caption" tone="secondary" style={styles.summaryMacros}>
                        {totals.protein} P · {totals.carbs} C · {totals.fat} G
                      </Text>
                      <Text variant="number">{totals.calories}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {hourFoods.map((food) => (
                    <LedgerFoodRow
                      key={food.id}
                      food={food}
                      onPress={onSelectFood}
                      onLongPress={onLongPressFood}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedFoodIds?.has(food.id) ?? false}
                      onToggleSelect={onToggleSelectFood}
                    />
                  ))}
                </>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const useStyles = makeStyles((t) => ({
  content: { paddingBottom: 120 },

  slot: { flexDirection: 'row' },
  slotEmpty: { minHeight: 34 },

  rail: { width: RAIL_W, alignItems: 'flex-end', paddingRight: 6 },
  line: {
    position: 'absolute',
    right: RAIL_W / 2 - 4,
    top: 0,
    bottom: 0,
    width: t.border.hairline,
    backgroundColor: t.colors.border,
  },
  node: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: t.space.sm },
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

  body: { flex: 1, minWidth: 0 },
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingTop: t.space.sm,
    paddingBottom: 2,
  },
  summaryMacros: { fontVariant: ['tabular-nums'] },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  emptyText: { textAlign: 'center', maxWidth: 260 },
}));
