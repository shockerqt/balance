import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Card, ProgressBar, Text } from '@/components/ui';
import { DayTargets } from '@/hooks/use-meal-store';

/* Los cuatro macros. Antes era el mismo bloque copiado cuatro veces,
   con dos de los colores escritos como literales. */

export interface MacroTotals {
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export const MacroGrid: React.FC<{ totals: MacroTotals; targets: DayTargets }> = ({
  totals,
  targets,
}) => {
  const theme = useTheme();

  const macros = [
    { label: 'PROTEÍNA', value: totals.protein, target: targets.targetProtein, color: theme.colors.macroProtein },
    { label: 'CARBS', value: totals.carbs, target: targets.targetCarbs, color: theme.colors.macroCarbs },
    { label: 'GRASAS', value: totals.fat, target: targets.targetFat, color: theme.colors.macroFat },
    { label: 'FIBRA', value: totals.fiber, target: targets.targetFiber, color: theme.colors.macroFiber },
  ];

  return (
    <View style={[styles.grid, { gap: theme.space.sm }]}>
      {macros.map((macro) => (
        <Card
          key={macro.label}
          raised
          padding="md"
          radius="md"
          style={styles.cell}
          accessibilityLabel={`${macro.label}: ${macro.value} de ${macro.target} gramos`}>
          <Text variant="label" tone="muted">
            {macro.label}
          </Text>
          <Text variant="number" style={{ marginTop: theme.space.xs, marginBottom: theme.space.sm }}>
            {macro.value}g
          </Text>
          <ProgressBar
            value={macro.target ? macro.value / macro.target : 0}
            color={macro.color}
            height={4}
          />
        </Card>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row' },
  cell: { flex: 1 },
});
