import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { sumDay, useMealStore } from '@/hooks/use-meal-store';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/theme';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { MacroGrid } from '@/components/summary/macro-grid';
import { WeeklyChart } from '@/components/summary/weekly-chart';
import { WeightTrendCard } from '@/components/weight/weight-trend-card';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { useWeightStore } from '@/hooks/use-weight-store';

/* Resumen del dia. No declara colores ni tamaños de fuente: todo
   sale del tema y de las primitivas. Su StyleSheet es solo layout. */

const initialsOf = (name?: string) =>
  (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export default function SummaryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { currentDayLog, dayLogs } = useMealStore();
  const { user, isGuest } = useAuth();
  const { preferencesReady, weightTrackingEnabled } = usePreferencesStore();
  const { weightsByDate } = useWeightStore();

  const totals = useMemo(() => sumDay(currentDayLog.foods), [currentDayLog.foods]);

  const remaining = Math.max(0, currentDayLog.targetCalories - totals.calories);
  const ratio = currentDayLog.targetCalories ? totals.calories / currentDayLog.targetCalories : 0;
  const over = totals.calories > currentDayLog.targetCalories;

  const greeting = isGuest ? 'Hola' : user?.name ? `Hola, ${user.name}` : 'Hola';

  const openAddFood = () => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0'
    )}`;
    router.push({ pathname: '/food-search', params: { dateId: currentDayLog.dateId, time } });
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: theme.space.xl, gap: theme.space.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={[styles.row, { gap: theme.space.md }]}>
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderWidth: theme.border.hairline,
                },
              ]}
            >
              <Text variant="heading">{initialsOf(user?.name)}</Text>
            </View>
            <View>
              <Text variant="caption" tone="secondary">
                {greeting}
              </Text>
              <Text variant="title">Resumen diario</Text>
            </View>
          </View>
          <Button
            title="Configuración"
            variant="ghost"
            size="md"
            onPress={() => router.push('/settings')}
            accessibilityLabel="Abrir Configuración"
          />
        </View>

        <Card>
          <View style={styles.heroTop}>
            <View>
              <Text variant="label" tone="muted">
                CALORÍAS RESTANTES
              </Text>
              <View style={[styles.row, styles.baseline, { gap: theme.space.xs }]}>
                <Text variant="numberLarge">{remaining}</Text>
                <Text variant="body" tone="secondary">
                  / {currentDayLog.targetCalories} kcal
                </Text>
              </View>
            </View>

            <View
              style={{
                backgroundColor: theme.colors.surfaceRaised,
                borderRadius: theme.radius.sm,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.xs,
              }}
            >
              <Text variant="number" tone={over ? 'danger' : 'accent'}>
                {Math.round(ratio * 100)}%
              </Text>
            </View>
          </View>

          <View style={{ marginTop: theme.space.lg, marginBottom: theme.space.xl }}>
            <ProgressBar value={ratio} over={over} />
          </View>

          <MacroGrid totals={totals} targets={currentDayLog} />
        </Card>

        <Button title="Registrar comida" onPress={openAddFood} />

        {preferencesReady && weightTrackingEnabled ? (
          <WeightTrendCard
            dateId={currentDayLog.dateId}
            weightsByDate={weightsByDate}
            onPress={() =>
              router.push({ pathname: '/weight-entry', params: { dateId: currentDayLog.dateId } })
            }
          />
        ) : null}

        <WeeklyChart dayLogs={dayLogs} referenceDateId={currentDayLog.dateId} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  baseline: { alignItems: 'baseline' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
});
