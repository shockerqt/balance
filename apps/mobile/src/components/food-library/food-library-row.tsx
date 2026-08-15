import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import type { LibraryFoodItem } from '@/hooks/use-food-library-store';
import { Icon, Text } from '@/components/ui';
import { makeStyles } from '@/theme';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';

interface FoodLibraryRowProps {
  food: LibraryFoodItem;
  onPress: (food: LibraryFoodItem) => void;
}

export const FoodLibraryRow: React.FC<FoodLibraryRowProps> = ({ food, onPress }) => {
  const styles = useStyles();
  const isOfficial = food.isOfficial === true;
  const calories = formatCalories(food.calories);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${food.name}, ${calories} kilocalorías, ${
        isOfficial ? 'alimento oficial' : 'alimento personal editable'
      }`}
      activeOpacity={0.72}
      delayPressIn={0}
      style={styles.row}
      onPress={() => onPress(food)}>
      <View style={styles.origin}>
        <Icon name={isOfficial ? 'badge-check' : 'notebook-pen'} size={16} tone={isOfficial ? 'muted' : 'accent'} />
        <Text variant="label" tone={isOfficial ? 'muted' : 'accent'}>
          {isOfficial ? 'BASE' : 'MÍO'}
        </Text>
      </View>

      <View style={styles.description}>
        <Text variant="bodyStrong" numberOfLines={1} selectable>
          {food.name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {food.portion}
          {food.category ? ` · ${food.category}` : ''}
        </Text>
        <View style={styles.macros}>
          <Text variant="caption" tone="primary">
            P {formatMacroGrams(food.protein)}g
          </Text>
          <Text variant="caption" tone="secondary">
            C {formatMacroGrams(food.carbs)}g
          </Text>
          <Text variant="caption" tone="muted">
            G {formatMacroGrams(food.fat)}g
          </Text>
          {food.fiber !== undefined ? (
            <Text variant="caption" tone="muted">
              F {formatMacroGrams(food.fiber)}g
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.energy}>
        <Text variant="number" selectable>
          {calories}
        </Text>
        <Text variant="caption" tone="muted">
          kcal
        </Text>
      </View>
      <Icon name="chevron-right" size={16} tone="muted" />
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    borderBottomWidth: t.border.hairline,
    borderBottomColor: t.colors.border,
    backgroundColor: t.colors.surface
  },
  origin: {
    width: 38,
    alignItems: 'center',
    gap: t.space.xs
  },
  description: { flex: 1, gap: t.space.xs },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  energy: { minWidth: 42, alignItems: 'flex-end' }
}));
