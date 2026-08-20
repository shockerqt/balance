import React from 'react';
import { StyleSheet, View, Text, ViewStyle } from 'react-native';
import Animated, { AnimatedStyle } from 'react-native-reanimated';
import { LoggedFoodItem } from '@/hooks/use-meal-store';
import { useTheme } from '@/theme';
import { formatCalories, formatMacroGrams, sumNutrition } from '@/lib/nutrition';

interface StickyMacroHeaderProps {
  foods: LoggedFoodItem[];
  targetCalories?: number;
  targetProtein?: number;
  targetCarbs?: number;
  targetFat?: number;
  targetFiber?: number;
  /* Estilo animado para la fila de cifras. La pantalla de registros lo usa para
     que el resumen acompane el swipe entre dias. Se aplica al contenido y no al
     contenedor a proposito: desplazar la superficie dejaria ver el fondo por el
     canto, y el borde inferior se despegaria del ancho de la pantalla. */
  contentStyle?: AnimatedStyle<ViewStyle>;
}

export const StickyMacroHeader: React.FC<StickyMacroHeaderProps> = React.memo(({
  foods,
  targetCalories = 2200,
  targetProtein = 150,
  targetCarbs = 220,
  targetFat = 65,
  targetFiber = 30,
  contentStyle,
}) => {
  const theme = useTheme();
  const totals = sumNutrition(foods);

  const calPercent = Math.min(Math.round((totals.calories / targetCalories) * 100), 100);
  const isOverCal = totals.calories > targetCalories;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      {/* Primary Metrics Row */}
      <Animated.View style={[styles.topRow, contentStyle]}>
        <View style={styles.calBox}>
          <Text style={[styles.calMain, { color: theme.colors.text }, isOverCal && { color: theme.colors.danger }]}>
            {formatCalories(totals.calories)} <Text style={[styles.calTarget, { color: theme.colors.textSecondary }]}>/ {formatCalories(targetCalories)} kcal</Text>
          </Text>
        </View>

        <View style={styles.macrosRow}>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            P <Text style={[styles.macroVal, { color: theme.colors.text }]}>{formatMacroGrams(totals.protein)}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            C <Text style={[styles.macroVal, { color: theme.colors.text }]}>{formatMacroGrams(totals.carbs)}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            G <Text style={[styles.macroVal, { color: theme.colors.text }]}>{formatMacroGrams(totals.fat)}g</Text>
          </Text>
          <Text style={[styles.dot, { color: theme.colors.textMuted }]}>·</Text>
          <Text style={[styles.macroText, { color: theme.colors.textSecondary }]}>
            F <Text style={[styles.macroVal, { color: theme.colors.text }]}>{formatMacroGrams(totals.fiber)}g</Text>
          </Text>
        </View>
      </Animated.View>

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
});

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
