import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { FoodRow } from '@/components/meal/food-row';

interface FluidTimelineFeedProps {
  foods: LoggedFoodItem[];
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtTime: (time: string) => void;
  onDeleteFood?: (foodId: string) => void;
}

export const FluidTimelineFeed: React.FC<FluidTimelineFeedProps> = ({
  foods,
  onSelectFood,
  onAddAtTime,
  onDeleteFood,
}) => {
  if (!foods || foods.length === 0) {
    return (
      <View style={styles.emptyFlexContainer}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sin registros para este día</Text>
          <Text style={styles.emptySubtitle}>
            Toca el botón [+] para agregar tu primera comida o alimento del día.
          </Text>
        </View>
      </View>
    );
  }

  // Group foods by timestamp ("HH:MM")
  const groupedFoods: Record<string, LoggedFoodItem[]> = {};
  foods.forEach((food) => {
    const timeKey = food.time || '12:00';
    if (!groupedFoods[timeKey]) {
      groupedFoods[timeKey] = [];
    }
    groupedFoods[timeKey].push(food);
  });

  // Sort timestamps chronologically
  const sortedTimes = Object.keys(groupedFoods).sort();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      {sortedTimes.map((timeKey) => {
        const groupFoods = groupedFoods[timeKey];

        // Calculate macro & calorie totals for this timestamp group
        const groupCalories = groupFoods.reduce((acc, f) => acc + (f.calories || 0), 0);
        const groupProtein = groupFoods.reduce((acc, f) => acc + (f.protein || 0), 0);
        const groupCarbs = groupFoods.reduce((acc, f) => acc + (f.carbs || 0), 0);
        const groupFat = groupFoods.reduce((acc, f) => acc + (f.fat || 0), 0);

        return (
          <View key={timeKey} style={styles.timestampBlock}>
            {/* Inline Timestamp Header Row (Pure Whitespace Separation) */}
            <View style={styles.timeHeaderRow}>
              <View style={styles.headerLeftGroup}>
                {/* Time Badge Pill */}
                <View style={styles.timeBadgePill}>
                  <Text style={styles.timeBadgeText}>{timeKey}</Text>
                </View>

                {/* Soft Muted Group Macro & Calorie Summary */}
                <View style={styles.summaryStatsRow}>
                  <Text style={styles.groupStatsText}>
                    {groupCalories} kcal  ·  P {groupProtein}g  C {groupCarbs}g  G {groupFat}g
                  </Text>
                </View>
              </View>

              {/* (+) Circular Add Button */}
              <TouchableOpacity
                style={styles.addCircleBtn}
                delayPressIn={0}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => onAddAtTime(timeKey)}>
                <Text style={styles.addCircleIcon}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Continuous Food List for this timestamp */}
            <View style={styles.foodListWrapper}>
              {groupFoods.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  onPress={onSelectFood}
                  onDelete={onDeleteFood}
                />
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080B11',
  },
  scrollContent: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  emptyFlexContainer: {
    flex: 1,
    backgroundColor: '#080B11',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: '#0E1420',
    borderWidth: 1,
    borderColor: '#1C2638',
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  timestampBlock: {
    marginBottom: 24,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
    marginBottom: 4,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  timeBadgePill: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  timeBadgeText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupStatsText: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  addCircleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCircleIcon: {
    color: '#3B82F6',
    fontSize: 18,
    fontWeight: '500',
    marginTop: -1,
  },
  foodListWrapper: {
    backgroundColor: '#080B11',
  },
});
