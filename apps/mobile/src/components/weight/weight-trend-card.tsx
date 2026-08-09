import React, { useMemo } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Card, Text } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';
import { WeightLogDoc } from '@/services/sync/types';
import { formatWeight, previousWeight, weightTrendDates } from '@/services/weight/weight';

interface WeightTrendCardProps {
  dateId: string;
  weightsByDate: Record<string, WeightLogDoc>;
  onPress: () => void;
}

export const WeightTrendCard: React.FC<WeightTrendCardProps> = ({
  dateId,
  weightsByDate,
  onPress,
}) => {
  const styles = useStyles();
  const theme = useTheme();
  const selected = weightsByDate[dateId];
  const previous = previousWeight(weightsByDate, dateId);
  const days = useMemo(
    () =>
      weightTrendDates(dateId).map((day) => ({
        ...day,
        weight: weightsByDate[day.id]?.weightGrams ?? null,
      })),
    [dateId, weightsByDate]
  );
  const observed = days.flatMap((day) => (day.weight === null ? [] : [day.weight]));
  const min = observed.length ? Math.min(...observed) : 0;
  const max = observed.length ? Math.max(...observed) : 0;
  const delta = selected && previous ? (selected.weightGrams - previous.weightGrams) / 1000 : null;
  const accessibilitySummary = observed.length
    ? `${observed.length} mediciones en los últimos 7 días`
    : 'Sin mediciones en los últimos 7 días';

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${selected ? `${formatWeight(selected.weightGrams)} kilogramos` : 'Sin peso registrado'}. ${accessibilitySummary}`}
      activeOpacity={0.78}
      onPress={onPress}
    >
      <Card>
        <View style={styles.header}>
          <View style={styles.valueBlock}>
            <Text variant="label" tone="muted">
              PESO
            </Text>
            {selected ? (
              <View style={styles.valueRow}>
                <Text variant="numberLarge" selectable>
                  {formatWeight(selected.weightGrams)}
                </Text>
                <Text variant="body" tone="secondary">
                  kg
                </Text>
              </View>
            ) : (
              <Text variant="heading">Registrar peso</Text>
            )}
            <Text variant="caption" tone="secondary">
              {delta === null
                ? 'Un registro por día'
                : `${delta > 0 ? '+' : ''}${delta.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg desde el registro anterior`}
            </Text>
          </View>
          <Text variant="bodyStrong" tone="accent">
            {selected ? 'Editar' : 'Añadir'}
          </Text>
        </View>

        <View style={styles.chart} accessibilityElementsHidden>
          {days.map((day) => {
            const height =
              day.weight === null
                ? 0
                : max === min
                  ? 55
                  : 20 + ((day.weight - min) / (max - min)) * 80;
            return (
              <View key={day.id} style={styles.column}>
                <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
                  {day.weight !== null ? (
                    <View
                      style={[
                        styles.bar,
                        { height: `${height}%`, backgroundColor: theme.colors.primary },
                      ]}
                    />
                  ) : null}
                </View>
                <Text variant="label" tone="muted">
                  {day.initial}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const useStyles = makeStyles((t) => ({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: t.space.lg },
  valueBlock: { flex: 1, gap: t.space.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: t.space.xs },
  chart: { flexDirection: 'row', height: 68, alignItems: 'flex-end', marginTop: t.space.xl },
  column: { flex: 1, alignItems: 'center', gap: t.space.xs },
  track: {
    width: 6,
    height: 48,
    justifyContent: 'flex-end',
    borderRadius: t.radius.pill,
    overflow: 'hidden',
  },
  bar: { width: '100%', borderRadius: t.radius.pill },
}));
