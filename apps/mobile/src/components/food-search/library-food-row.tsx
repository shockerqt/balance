import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { makeStyles } from '@/theme';
import { Text } from '@/components/ui';
import { LibraryFoodItem } from '@/hooks/use-food-library-store';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';

/* Fila de alimento de la libreria. Estaba escrita dos veces palabra
   por palabra dentro de food-search: una en "sugeridos" y otra en
   "todos los alimentos". */

export const LibraryFoodRow: React.FC<{
  food: LibraryFoodItem;
  onPick: (food: LibraryFoodItem) => void;
}> = ({ food, onPick }) => {
  const styles = useStyles();
  const calories = formatCalories(food.calories);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Agregar ${food.name}, ${calories} kilocalorías`}
      style={styles.row}
      delayPressIn={0}
      activeOpacity={0.7}
      onPress={() => onPick(food)}>
      <View style={styles.left}>
        <Text variant="bodyStrong" numberOfLines={1} selectable>
          {food.name}
        </Text>
        <View style={styles.meta}>
          <Text variant="caption" tone="accent">
            {calories} kcal
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="secondary">
            P {formatMacroGrams(food.protein)}g C {formatMacroGrams(food.carbs)}g G{' '}
            {formatMacroGrams(food.fat)}g
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="muted">
            {food.portion}
          </Text>
        </View>
      </View>

      <View style={styles.add}>
        <Text variant="heading" tone="onPrimary">
          +
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.md,
    paddingVertical: t.space.md,
    paddingHorizontal: t.space.lg,
    borderBottomWidth: t.border.hairline,
    borderBottomColor: t.colors.border,
  },
  left: { flex: 1, gap: t.space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, flexWrap: 'wrap' },
  add: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.primary,
  },
}));
