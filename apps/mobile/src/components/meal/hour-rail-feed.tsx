import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { DEFAULT_HOUR_RANGE, HourRange, buildHourRail, sumFoods } from '@/lib/hours';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';
import { LedgerFoodRow } from './ledger-food-row';

/* ============================================================
   Riel de horas.

   Una sola regla, sin casos especiales: cada hora del tramo es un
   nodo. Lleno si tiene comida, apagado si no, y todos son tocables.
   Tocar un nodo registra a esa hora, tenga o no algo ya.

   El riel cubre siempre el rango configurado, asi que un dia vacio
   muestra el dia entero listo para anotar, y las horas posteriores a
   la ultima comida siguen a un toque.
   ============================================================ */

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
};

export const HourRailFeed: React.FC<{
  foods: LoggedFoodItem[];
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtHour: (hour: string) => void;
  /** Tramo visible del día. Por defecto de 05:00 a 22:00. */
  hourRange?: HourRange;
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
  hourRange = DEFAULT_HOUR_RANGE,
  isSelectionMode = false,
  selectedFoodIds,
  onLongPressFood,
  onLongPressGroup,
  onToggleSelectFood,
  onToggleSelectGroup,
}) => {
  const styles = useStyles();
  const rail = useMemo(() => buildHourRail(foods, hourRange), [foods, hourRange]);
  const isEmpty = foods.length === 0;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {isEmpty ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          Toca una hora para anotar lo que comiste
        </Text>
      ) : null}

      {rail.map(({ hour, foods: hourFoods }, index) => {
        const filled = hourFoods.length > 0;
        const ids = hourFoods.map((f) => f.id);
        const totals = filled ? sumFoods(hourFoods) : null;
        const isLast = index === rail.length - 1;

        return (
          <View key={hour} style={[styles.slot, !filled && styles.slotEmpty]}>
            <View style={styles.rail}>
              {/* Arriba la linea sube hasta el borde y engancha con el slot
                  anterior; abajo se corta en el ultimo nodo, para que el dia
                  termine donde termina el contenido. */}
              <View style={styles.lineTop} />
              {!isLast ? <View style={styles.lineBottom} /> : null}
              <View style={styles.nodeBox}>
                <HourNode hour={hour} filled={filled} onPress={() => onAddAtHour(hour)} />
              </View>
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
                      <Text variant="caption" tone="secondary" style={styles.tabular}>
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

  body: { flex: 1, minWidth: 0, paddingTop: 4 },
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
