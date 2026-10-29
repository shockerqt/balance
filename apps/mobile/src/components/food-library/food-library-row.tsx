import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import type { LibraryFoodItem } from '@/hooks/use-food-library-store';
import { Icon, Text } from '@/components/ui';
import { makeStyles } from '@/theme';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';

interface FoodLibraryRowProps {
  food: LibraryFoodItem;
  first?: boolean;
  last?: boolean;
  onPress: (food: LibraryFoodItem) => void;
}

export const FoodLibraryRow: React.FC<FoodLibraryRowProps> = ({ food, onPress, first, last }) => {
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
      style={[styles.row, first && { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, last && { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, borderBottomWidth: 0 }]}
      onPress={() => onPress(food)}>
      <View style={styles.description}>
        <Text variant="bodyStrong" numberOfLines={2} selectable>
          {food.name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {food.portion}
          {` · ${isOfficial ? 'Oficial' : 'Personal'}`}
        </Text>
      </View>

      <View style={styles.energy}>
        <Text variant="number" selectable>
          {calories}
        </Text>
        <Text variant="caption" tone="muted">
          kcal
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  row: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.lg,
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
