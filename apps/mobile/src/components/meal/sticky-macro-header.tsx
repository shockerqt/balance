import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { useTheme } from '@/theme';

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
  const theme = useTheme();
  const totalCal = foods.reduce((sum, f) => sum + (f.calories || 0), 0);
  const totalP = foods.reduce((sum, f) => sum + (f.protein || 0), 0);
  const totalC = foods.reduce((sum, f) => sum + (f.carbs || 0), 0);
  const totalF = foods.reduce((sum, f) => sum + (f.fat || 0), 0);
  const totalFib = foods.reduce((sum, f) => sum + (f.fiber || 0), 0);

  const calPercent = Math.min(Math.round((totalCal / targetCalories) * 100), 100);
  const isOverCal = totalCal > targetCalories;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      {/* Primary Metrics Row */}
      <View style={styles.topRow}>
        <View style={styles.calBox}>
          <Text style={[styles.calMain, { color: theme.colors.text }, isOverCal && { color: theme.colors.danger }]}>
            {totalCal} <Text style={[styles.calTarget, { color: theme.colors.textSecondary }]}>/ {targetCalories} kcal</Text>
          </Text>
          <View style={[styles.badgeBox, { backgroundColor: theme.colors.surfaceRaised }]}>
            <Text style={[styles.badgeText, { color: theme.colors.textSecondary }]}>{calPercent}%</Text>
          </View>
        </View>

        <View style={styles.macrosRow}>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            P <Text style={[styles.macroVal, { color: theme.colors.text }]}>{totalP}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            C <Text style={[styles.macroVal, { color: theme.colors.text }]}>{totalC}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            G <Text style={[styles.macroVal, { color: theme.colors.text }]}>{totalF}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            F <Text style={[styles.macroVal, { color: theme.colors.text }]}>{totalFib}g</Text>
          </Text>
        </View>
      </View>

      {/* Thin progress bar */}
      <View style={[styles.barBg, { backgroundColor: theme.colors.border }]}>
        <View
          style={[
            styles.barFill,
            { width: `${calPercent}%`, backgroundColor: theme.colors.primary },
            isOverCal && { backgroundColor: theme.colors.danger },
          ]}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
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
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  calTarget: {
    fontSize: 12,
    fontWeight: '400',
  },
  badgeBox: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  macrosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  macroText: {
    fontSize: 12,
    fontWeight: '400',
  },
  macroVal: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    fontSize: 12,
  },
  barBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
});
