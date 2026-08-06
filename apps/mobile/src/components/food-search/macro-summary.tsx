import React from 'react';
import { View } from 'react-native';
import { makeStyles } from '@/theme';
import { Card, Text } from '@/components/ui';
import { ScaledMacros } from '@/lib/portion';

/* Cuadro de macros recalculados. La celda estaba repetida cuatro
   veces con la unica diferencia del valor y la etiqueta. */

export const MacroSummary: React.FC<{ macros: ScaledMacros; title?: string }> = ({
  macros,
  title = 'Métricas recalculadas',
}) => {
  const styles = useStyles();

  const cells = [
    { value: `${macros.calories}`, label: 'kcal', accent: true },
    { value: `${macros.protein}g`, label: 'Proteína' },
    { value: `${macros.carbs}g`, label: 'Carbos' },
    { value: `${macros.fat}g`, label: 'Grasas' },
  ];

  return (
    <Card>
      <Text variant="label" tone="muted">
        {title.toUpperCase()}
      </Text>

      <View style={styles.grid}>
        {cells.map((cell) => (
          <View key={cell.label} style={styles.cell}>
            <Text variant="number" tone={cell.accent ? 'accent' : 'primary'}>
              {cell.value}
            </Text>
            <Text variant="caption" tone="muted">
              {cell.label}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

const useStyles = makeStyles((t) => ({
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: t.space.md,
    gap: t.space.sm,
  },
  cell: { flex: 1, alignItems: 'center', gap: t.space.xs },
}));
