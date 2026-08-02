import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';

interface StickyMacroHeaderProps {
  foods: LoggedFoodItem[];
  targetCalories?: number;
  targetProtein?: number;
  targetCarbs?: number;
  targetFat?: number;
  targetFiber?: number;
}

export const StickyMacroHeader: React.FC<StickyMacroHeaderProps> = ({
  foods,
  targetCalories = 2200,
  targetProtein = 150,
  targetCarbs = 220,
  targetFat = 65,
  targetFiber = 30,
}) => {
  const totalCal = foods.reduce((sum, f) => sum + (f.calories || 0), 0);
  const totalP = foods.reduce((sum, f) => sum + (f.protein || 0), 0);
  const totalC = foods.reduce((sum, f) => sum + (f.carbs || 0), 0);
  const totalF = foods.reduce((sum, f) => sum + (f.fat || 0), 0);
  const totalFib = foods.reduce((sum, f) => sum + (f.fiber || 0), 0);

  const calPercent = Math.min(Math.round((totalCal / targetCalories) * 100), 100);
  const isOverCal = totalCal > targetCalories;

  return (
    <View style={styles.container}>
      {/* Primary Metrics Row */}
      <View style={styles.topRow}>
        <View style={styles.calBox}>
          <Text style={[styles.calMain, isOverCal && styles.calOverText]}>
            {totalCal} <Text style={styles.calTarget}>/ {targetCalories} kcal</Text>
          </Text>
          <View style={styles.badgeBox}>
            <Text style={styles.badgeText}>{calPercent}%</Text>
          </View>
        </View>

        <View style={styles.macrosRow}>
          <Text style={styles.macroText}>
            P <Text style={styles.macroVal}>{totalP}g</Text>
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.macroText}>
            C <Text style={styles.macroVal}>{totalC}g</Text>
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.macroText}>
            G <Text style={styles.macroVal}>{totalF}g</Text>
          </Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.macroText}>
            F <Text style={styles.macroVal}>{totalFib}g</Text>
          </Text>
        </View>
      </View>

      {/* Ultra-thin neutral progress bar */}
      <View style={styles.barBg}>
        <View
          style={[
            styles.barFill,
            { width: `${calPercent}%` },
            isOverCal && { backgroundColor: '#EF4444' },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0E1420',
    borderBottomWidth: 1,
    borderBottomColor: '#1C2638',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  calBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calMain: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  calTarget: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '400',
  },
  calOverText: {
    color: '#EF4444',
  },
  badgeBox: {
    backgroundColor: '#1C2638',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  macrosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  macroText: {
    color: '#8E9BAE',
    fontSize: 12,
    fontWeight: '400',
  },
  macroVal: {
    color: '#F8FAFC',
    fontWeight: '600',
  },
  dot: {
    color: '#475569',
    fontSize: 12,
  },
  barBg: {
    height: 3,
    backgroundColor: '#1C2638',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },
});
