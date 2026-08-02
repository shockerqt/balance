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
      {sortedTimes.map((timeKey, index) => {
        const groupFoods = groupedFoods[timeKey];
        const isLastGroup = index === sortedTimes.length - 1;

        // Calculate macro & calorie totals for this timestamp group
        const groupCalories = groupFoods.reduce((acc, f) => acc + (f.calories || 0), 0);
        const groupProtein = groupFoods.reduce((acc, f) => acc + (f.protein || 0), 0);
        const groupCarbs = groupFoods.reduce((acc, f) => acc + (f.carbs || 0), 0);
        const groupFat = groupFoods.reduce((acc, f) => acc + (f.fat || 0), 0);

        return (
          <View key={timeKey} style={styles.timelineGroupBlock}>
            {/* Timestamp Header Row with Timeline Node Bullet */}
            <View style={styles.headerRow}>
              {/* Bullet Node Indicator */}
              <View style={styles.bulletNodeContainer}>
                <View style={styles.bulletNode} />
              </View>

              {/* Title & Macro Summary */}
              <View style={styles.headerTitleBox}>
                <View style={styles.timeKcalRow}>
                  <Text style={styles.timeText}>{timeKey}</Text>
                  <Text style={styles.dotSeparator}>·</Text>
                  <Text style={styles.groupKcalText}>{groupCalories} kcal</Text>
                </View>

                <Text style={styles.groupMacroText}>
                  P {groupProtein}g  ·  C {groupCarbs}g  ·  G {groupFat}g
                </Text>
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

            {/* Timeline Content Block (Vertical Line + Indented Foods List) */}
            <View style={styles.contentBodyRow}>
              {/* Vertical Connecting Line */}
              <View style={[styles.timelineVerticalLine, isLastGroup && styles.timelineLineLast]} />

              {/* Food List Container */}
              <View style={styles.foodItemsWrapper}>
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
  timelineGroupBlock: {
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
  },
  bulletNodeContainer: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletNode: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#080B11',
    borderWidth: 2.5,
    borderColor: '#3B82F6',
    boxShadow: '0 0 6px rgba(59, 130, 246, 0.5)',
  },
  headerTitleBox: {
    flex: 1,
    paddingLeft: 8,
  },
  timeKcalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dotSeparator: {
    color: '#475569',
    fontSize: 12,
  },
  groupKcalText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  groupMacroText: {
    color: '#8E9BAE',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
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
  contentBodyRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  timelineVerticalLine: {
    width: 24,
    alignItems: 'center',
    borderRightWidth: 2,
    borderRightColor: '#1C2638',
  },
  timelineLineLast: {
    borderRightColor: 'transparent',
  },
  foodItemsWrapper: {
    flex: 1,
    paddingLeft: 8,
  },
});
