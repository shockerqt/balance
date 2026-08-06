import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { makeStyles } from '@/theme';
import { Icon, Text } from '@/components/ui';

/* ============================================================
   Asiento del libro.

   El nombre y su detalle toman la linea entera; las calorias se
   alinean a la derecha y los macros bajan como linea subordinada.
   En un telefono las cuatro columnas y el nombre se pelean el ancho,
   y los nombres de alimentos con marca son largos.
   ============================================================ */

export const LedgerFoodRow: React.FC<{
  food: LoggedFoodItem;
  onPress: (food: LoggedFoodItem) => void;
  onLongPress?: (food: LoggedFoodItem) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (foodId: string) => void;
}> = ({ food, onPress, onLongPress, isSelectionMode = false, isSelected = false, onToggleSelect }) => {
  const styles = useStyles();

  const handlePress = () => {
    if (isSelectionMode && onToggleSelect) onToggleSelect(food.id);
    else onPress(food);
  };

  const detail = [food.time, food.portion].filter(Boolean).join(' · ');

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: isSelectionMode ? isSelected : undefined }}
      accessibilityLabel={`${food.name}, ${food.calories} kilocalorías`}
      style={[styles.row, isSelected && styles.rowSelected]}
      delayPressIn={0}
      activeOpacity={0.7}
      onPress={handlePress}
      onLongPress={() => onLongPress?.(food)}>
      {isSelectionMode ? (
        <View style={[styles.check, isSelected && styles.checkOn]}>
          {isSelected ? <Icon name="check" size={12} tone="onPrimary" /> : null}
        </View>
      ) : null}

      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {food.name}
          </Text>
          <Text variant="number">{food.calories}</Text>
        </View>

        <View style={styles.line}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
            {detail}
          </Text>
          <Text variant="caption" tone="secondary" style={styles.macros}>
            {food.protein} P · {food.carbs} C · {food.fat} G
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingVertical: t.space.sm,
    paddingHorizontal: t.space.lg,
    borderBottomWidth: t.border.hairline,
    borderBottomColor: t.colors.border,
  },
  rowSelected: { backgroundColor: t.colors.surfaceRaised },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: t.space.md,
  },
  name: { flex: 1, minWidth: 0 },
  macros: { fontVariant: ['tabular-nums'] },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: t.border.hairline,
    borderColor: t.colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
}));
