import React from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { FoodRow } from '@/components/meal/food-row';
import { useTheme } from '@/hooks/use-theme';

interface FluidTimelineFeedProps {
  foods: LoggedFoodItem[];
  onSelectFood: (food: LoggedFoodItem) => void;
  onAddAtTime: (time: string) => void;
  onDeleteFood?: (foodId: string) => void;
  isSelectionMode?: boolean;
  selectedFoodIds?: Set<string>;
  onLongPressFood?: (food: LoggedFoodItem) => void;
  onLongPressGroup?: (timeKey: string, groupFoodIds: string[]) => void;
  onToggleSelectFood?: (foodId: string) => void;
  onToggleSelectGroup?: (timeKey: string, groupFoodIds: string[]) => void;
}

export const FluidTimelineFeed: React.FC<FluidTimelineFeedProps> = ({
  foods,
  onSelectFood,
  onAddAtTime,
  isSelectionMode = false,
  selectedFoodIds = new Set(),
  onLongPressFood,
  onLongPressGroup,
  onToggleSelectFood,
  onToggleSelectGroup,
}) => {
  const theme = useTheme();

  if (!foods || foods.length === 0) {
    return (
      <View style={[styles.emptyFlexContainer, { backgroundColor: theme.background }]}>
        <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.surfaceBorder }]}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>Sin registros para este día</Text>
          <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
            Toca el botón [+] para agregar tu primera comida o alimento del día.
          </Text>
        </View>
      </View>
    );
  }

  const groupedFoods: Record<string, LoggedFoodItem[]> = {};
  foods.forEach((food) => {
    const timeKey = food.time || '12:00';
    if (!groupedFoods[timeKey]) {
      groupedFoods[timeKey] = [];
    }
    groupedFoods[timeKey].push(food);
  });

  const sortedTimes = Object.keys(groupedFoods).sort();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}>
      {sortedTimes.map((timeKey) => {
        const groupFoods = groupedFoods[timeKey];
        const groupFoodIds = groupFoods.map((f) => f.id);
        const isGroupFullySelected = groupFoodIds.every((id) => selectedFoodIds.has(id));

        const groupCalories = groupFoods.reduce((acc, f) => acc + (f.calories || 0), 0);
        const groupProtein = groupFoods.reduce((acc, f) => acc + (f.protein || 0), 0);
        const groupCarbs = groupFoods.reduce((acc, f) => acc + (f.carbs || 0), 0);
        const groupFat = groupFoods.reduce((acc, f) => acc + (f.fat || 0), 0);

        const handleGroupHeaderPress = () => {
          if (isSelectionMode && onToggleSelectGroup) {
            onToggleSelectGroup(timeKey, groupFoodIds);
          }
        };

        const handleGroupHeaderLongPress = () => {
          if (onLongPressGroup) {
            onLongPressGroup(timeKey, groupFoodIds);
          }
        };

        return (
          <View key={timeKey} style={styles.timestampBlock}>
            {/* Header Row */}
            <View style={styles.timeHeaderRow}>
              <TouchableOpacity
                style={styles.headerRowTouchArea}
                delayPressIn={0}
                activeOpacity={0.7}
                onPress={handleGroupHeaderPress}
                onLongPress={handleGroupHeaderLongPress}>
                {isSelectionMode && (
                  <View style={styles.groupCheckboxCircleWrapper}>
                    <View
                      style={[
                        styles.groupCheckboxCircle,
                        { borderColor: theme.textMuted },
                        isGroupFullySelected && { backgroundColor: theme.primary, borderColor: theme.primary },
                      ]}>
                      {isGroupFullySelected && <Text style={[styles.checkmarkIcon, { color: theme.primaryText }]}>✓</Text>}
                    </View>
                  </View>
                )}

                <View style={[styles.timeBadgePill, { backgroundColor: theme.surface, borderColor: theme.primary }]}>
                  <Text style={[styles.timeBadgeText, { color: theme.textPrimary }]}>{timeKey}</Text>
                </View>

                <View style={styles.summaryStatsRow}>
                  <Text style={[styles.groupStatsText, { color: theme.textSecondary }]}>
                    {groupCalories} kcal  ·  P {groupProtein}g  C {groupCarbs}g  G {groupFat}g
                  </Text>
                </View>
              </TouchableOpacity>

              {!isSelectionMode && (
                <TouchableOpacity
                  style={[styles.addCircleBtn, { backgroundColor: theme.surface, borderColor: theme.primary }]}
                  delayPressIn={0}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => onAddAtTime(timeKey)}>
                  <Text style={[styles.addCircleIcon, { color: theme.primary }]}>+</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Food List */}
            <View style={[styles.foodListWrapper, { backgroundColor: theme.background }]}>
              {groupFoods.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  onPress={onSelectFood}
                  onLongPress={onLongPressFood}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedFoodIds.has(food.id)}
                  onToggleSelect={onToggleSelectFood}
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
  },
  scrollContent: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  emptyFlexContainer: {
    flex: 1,
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
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  timestampBlock: {
    marginBottom: 20,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
    marginBottom: 4,
  },
  headerRowTouchArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    flex: 1,
    paddingRight: 8,
    paddingVertical: 4,
  },
  groupCheckboxCircleWrapper: {
    paddingRight: 2,
  },
  groupCheckboxCircle: {
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
  timeBadgePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  timeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  summaryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupStatsText: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  addCircleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCircleIcon: {
    fontSize: 18,
    fontWeight: '500',
    marginTop: -1,
  },
  foodListWrapper: {},
});
