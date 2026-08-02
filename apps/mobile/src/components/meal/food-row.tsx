import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';

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
      style={[styles.container, isSelected && styles.containerSelected]}
      delayPressIn={0}
      activeOpacity={0.7}
      onPress={handlePress}
      onLongPress={handleLongPress}>
      {/* Selection Mode Checkbox Indicator */}
      {isSelectionMode && (
        <View style={styles.checkboxWrapper}>
          <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
            {isSelected && <Text style={styles.checkmarkIcon}>✓</Text>}
          </View>
        </View>
      )}

      <View style={styles.mainContent}>
        {/* Line 1: Name */}
        <Text style={styles.nameText} numberOfLines={1}>
          {food.name}
        </Text>

        {/* Line 2: Kcal · P C G · Portion */}
        <View style={styles.detailRow}>
          <Text style={styles.kcalText}>{food.calories} kcal</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.macroText}>
            P {food.protein}g  C {food.carbs}g  G {food.fat}g
          </Text>
          {food.portion ? (
            <>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.portionText}>{food.portion}</Text>
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    borderRadius: 10,
  },
  containerSelected: {
    backgroundColor: '#1E293B',
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
    borderColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCircleSelected: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  checkmarkIcon: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginTop: -1,
  },
  mainContent: {
    flex: 1,
    paddingRight: 8,
  },
  nameText: {
    color: '#F8FAFC',
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
    color: '#F87171',
    fontSize: 13,
    fontWeight: '500',
  },
  macroText: {
    color: '#8E9BAE',
    fontSize: 13,
    fontWeight: '400',
  },
  portionText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '400',
  },
  dot: {
    color: '#475569',
    fontSize: 12,
  },
});
