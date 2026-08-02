import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';

interface FoodRowProps {
  food: LoggedFoodItem;
  onPress: (food: LoggedFoodItem) => void;
  onDelete?: (foodId: string) => void;
}

export const FoodRow: React.FC<FoodRowProps> = ({ food, onPress, onDelete }) => {
  return (
    <TouchableOpacity
      style={styles.container}
      delayPressIn={0}
      activeOpacity={0.7}
      onPress={() => onPress(food)}>
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

      {onDelete ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          delayPressIn={0}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => onDelete(food.id)}>
          <Text style={styles.deleteIcon}>✕</Text>
        </TouchableOpacity>
      ) : null}
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
  deleteBtn: {
    padding: 6,
  },
  deleteIcon: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
});
