import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Card, Text } from '@/components/ui';
import { DayLog, sumDay, toDateId } from '@/hooks/use-meal-store';

/* ============================================================
   Promedio de los ultimos 7 dias.

   Antes las barras eran `60 + (idx % 3) * 15`: el widget era
   decorativo y no leia dato alguno. Ahora sale del registro real, y
   los dias sin registro se muestran vacios en vez de inventados.
   ============================================================ */

const DAY_INITIALS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export const WeeklyChart: React.FC<{
  dayLogs: Record<string, DayLog>;
  /** El dia que se esta mirando; la ventana termina aqui. */
  referenceDateId: string;
}> = ({ dayLogs, referenceDateId }) => {
  const theme = useTheme();

  const days = useMemo(() => {
    const [y, m, d] = referenceDateId.split('-').map(Number);
    const end = y && m && d ? new Date(y, m - 1, d) : new Date();

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(end);
      date.setDate(date.getDate() - (6 - i));
      const id = toDateId(date);
      const log = dayLogs[id];
      return {
        id,
        initial: DAY_INITIALS[date.getDay()] ?? '',
        calories: log ? sumDay(log.foods).calories : null,
      };
    });
  }, [dayLogs, referenceDateId]);

  const logged = days.filter((d) => d.calories !== null) as { calories: number }[];
  const average = logged.length
    ? Math.round(logged.reduce((s, d) => s + d.calories, 0) / logged.length)
    : 0;
  const peak = Math.max(...days.map((d) => d.calories ?? 0), 1);

  return (
    <Card>
      <View style={[styles.header, { marginBottom: theme.space.lg }]}>
        <Text variant="caption" tone="secondary">
          Promedio últimos 7 días
        </Text>
        <Text variant="number">
          {logged.length ? `${average.toLocaleString('es-CL')} kcal/día` : 'Sin registros'}
        </Text>
      </View>

      <View style={styles.row}>
        {days.map((day) => (
          <View key={day.id} style={[styles.col, { gap: theme.space.xs }]}>
            <View
              style={[
                styles.track,
                { backgroundColor: theme.colors.border, borderRadius: theme.radius.sm },
              ]}>
              {day.calories !== null && (
                <View
                  style={{
                    width: '100%',
                    height: `${Math.max(4, (day.calories / peak) * 100)}%`,
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radius.sm,
                  }}
                />
              )}
            </View>
            <Text variant="label" tone="muted">
              {day.initial}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 76 },
  col: { alignItems: 'center', flex: 1 },
  track: { width: 8, height: 60, justifyContent: 'flex-end', overflow: 'hidden' },
});
