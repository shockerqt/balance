import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { FoodRow } from './food-row';

interface FluidTimelineFeedProps {
  foods: LoggedFoodItem[];
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtTime: (time: string) => void;
  onDeleteFood: (foodId: string) => void;
}

export const FluidTimelineFeed: React.FC<FluidTimelineFeedProps> = ({
  foods,
  onSelectFood,
  onAddAtTime,
  onDeleteFood,
}) => {
  // Group foods by time
  const timeMap = foods.reduce<Record<string, LoggedFoodItem[]>>((acc, food) => {
    const timeKey = food.time || '12:00';
    if (!acc[timeKey]) acc[timeKey] = [];
    acc[timeKey].push(food);
    return acc;
  }, {});

  // Sort times chronologically
  const sortedTimes = Object.keys(timeMap).sort();

  if (foods.length === 0) {
    return (
      <View style={styles.emptyFlexContainer}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sin registros para este día</Text>
          <Text style={styles.emptySubtitle}>
            Toca el botón '+' para registrar tu primera comida o desliza horizontalmente entre días.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {sortedTimes.map((timeKey) => {
        const groupFoods = timeMap[timeKey];
        const groupCal = groupFoods.reduce((sum, f) => sum + (f.calories || 0), 0);

        return (
          <View key={timeKey} style={styles.timeBlock}>
            {/* Minimalist Time Header Divider */}
            <View style={styles.timeHeaderRow}>
              <View style={styles.timeTitleBox}>
                <View style={styles.timeDot} />
                <Text style={styles.timeText}>{timeKey}</Text>
                <Text style={styles.timeCalText}>({groupCal} kcal)</Text>
              </View>

              <TouchableOpacity
                style={styles.addBtn}
                activeOpacity={0.7}
                onPress={() => onAddAtTime(timeKey)}>
                <Text style={styles.addBtnText}>+ Agregar</Text>
              </TouchableOpacity>
            </View>

            {/* Continuous food list */}
            <View style={styles.foodListContainer}>
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
    paddingVertical: 12,
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
  timeBlock: {
    marginBottom: 16,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
    marginBottom: 4,
  },
  timeTitleBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
  },
  timeText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '700',
  },
  timeCalText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '400',
  },
  addBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#161E2E',
  },
  addBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  foodListContainer: {
    paddingLeft: 6,
  },
});
