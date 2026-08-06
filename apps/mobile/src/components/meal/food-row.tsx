import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { useTheme } from '@/theme';

interface FoodRowProps {
  food: LoggedFoodItem;
  onPress: (food: LoggedFoodItem) => void;
  onLongPress?: (food: LoggedFoodItem) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (foodId: string) => void;
}

export const FoodRow: React.FC<FoodRowProps> = ({
  food,
  onPress,
  onLongPress,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const theme = useTheme();

  const handlePress = () => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(food.id);
    } else {
      onPress(food);
    }
  };

  const handleLongPress = () => {
    if (onLongPress) {
      onLongPress(food);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: theme.colors.surfaceRaised },
        isSelected && { backgroundColor: theme.colors.border, borderWidth: 1, borderColor: theme.colors.primary },
      ]}
      delayPressIn={0}
      activeOpacity={0.7}
      onPress={handlePress}
      onLongPress={handleLongPress}>
      {isSelectionMode && (
        <View style={styles.checkboxWrapper}>
          <View
            style={[
              styles.checkboxCircle,
              { borderColor: theme.colors.textMuted },
              isSelected && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
            ]}>
            {isSelected && <Text style={[styles.checkmarkIcon, { color: theme.colors.onPrimary }]}>✓</Text>}
          </View>
        </View>
      )}

      <View style={styles.mainContent}>
        {/* Line 1: Name */}
        <Text style={[styles.nameText, { color: theme.colors.text }]} numberOfLines={1}>
          {food.name}
        </Text>

        {/* Line 2: Kcal · P C G · Portion */}
        <View style={styles.detailRow}>
          <Text style={[styles.kcalText, { color: theme.colors.danger }]}>{food.calories} kcal</Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            P {food.protein}g  C {food.carbs}g  G {food.fat}g
          </Text>
          {food.portion ? (
            <>
              <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
              <Text style={[styles.portionText, { color: theme.colors.textMuted }]}>{food.portion}</Text>
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    borderRadius: 12,
  },
  checkboxWrapper: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkIcon: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: -1,
  },
  mainContent: {
    flex: 1,
    paddingRight: 8,
  },
  nameText: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  kcalText: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  macroText: {
    fontSize: 13,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  portionText: {
    fontSize: 13,
    fontWeight: '400',
  },
  dot: {
    fontSize: 12,
  },
});
