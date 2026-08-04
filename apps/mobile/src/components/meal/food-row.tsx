import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { useTheme } from '@/hooks/use-theme';

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
        { backgroundColor: theme.cardBackground },
        isSelected && { backgroundColor: theme.accentMuted, borderWidth: 1, borderColor: theme.primary },
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
              { borderColor: theme.textMuted },
              isSelected && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}>
            {isSelected && <Text style={[styles.checkmarkIcon, { color: theme.primaryText }]}>✓</Text>}
          </View>
        </View>
      )}

      <View style={styles.mainContent}>
        {/* Line 1: Name */}
        <Text style={[styles.nameText, { color: theme.textPrimary }]} numberOfLines={1}>
          {food.name}
        </Text>

        {/* Line 2: Kcal · P C G · Portion */}
        <View style={styles.detailRow}>
          <Text style={[styles.kcalText, { color: theme.kcalCoral }]}>{food.calories} kcal</Text>
          <Text style={[styles.dot, { color: theme.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.textSecondary }]}>
            P {food.protein}g  C {food.carbs}g  G {food.fat}g
          </Text>
          {food.portion ? (
            <>
              <Text style={[styles.dot, { color: theme.textMuted }]}>·</Text>
              <Text style={[styles.portionText, { color: theme.textMuted }]}>{food.portion}</Text>
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
