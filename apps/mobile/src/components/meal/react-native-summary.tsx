import React, { useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { Card, ProgressBar, Text } from '@/components/ui';
import { useMealStore } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { DEFAULT_TARGETS } from '@/lib/day-targets';
import { DAY_NAMES, MONTH_NAMES, parseDateId, todayId } from '@/lib/dates';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';
import { rangeSummary, summaryBuckets, type Bucket, type SummaryDay } from '@/lib/summary-buckets';
import { font, makeStyles, useTheme } from '@/theme';
import { createInterfaceDaysProjector } from './native/interface-contract';

const PERIODS = [7, 30, 90] as const;
const LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const kg = (value: number) => value.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const month = (date: string) => MONTH_NAMES[parseDateId(date).getUTCMonth()].slice(0, 3).toLocaleLowerCase('es');
const shortDate = (date: string) => `${parseDateId(date).getUTCDate()} ${month(date)}`;

export function ReactNativeSummary({ onOpen }: { onOpen: (date: string, body: boolean) => void }) {
  const styles = useStyles();
  const meals = useMealStore();
  const weight = useWeightStore();
  const preferences = usePreferencesStore();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(7);
  const end = todayId();
  const projector = useMemo(createInterfaceDaysProjector, []);
  const projected = useMemo(() => projector(meals.dayLogs, weight.weightsByDate, meals.mealDocuments), [projector, meals.dayLogs, meals.mealDocuments, weight.weightsByDate]);
  const days = useMemo(() => Object.fromEntries(Object.entries(projected).map(([date, day]) => [date, {
    recorded: day.recorded, calories: day.totals.calories, protein: day.totals.protein, carbs: day.totals.carbs, fat: day.totals.fat, weightKg: day.weightKg,
  } satisfies SummaryDay])), [projected]);
  const targets = { ...DEFAULT_TARGETS, ...meals.dayLogs[end] };
  const buckets = useMemo(() => summaryBuckets(days, end, period), [days, end, period]);
  const range = useMemo(() => rangeSummary(days, end, period), [days, end, period]);
  const weightOn = preferences.preferencesReady && preferences.weightTrackingEnabled;
  const latest = range.weights.at(-1);
  const delta = range.weights.length > 1 ? range.weights.at(-1)!.kg - range.weights[0].kg : null;

  return <View style={styles.screen}>
    <View style={styles.header}>
      <Text variant="display" accessibilityRole="header">Resumen</Text>
      <View style={styles.range} accessibilityRole="tablist">
        {PERIODS.map(value => <TouchableOpacity key={value} accessibilityRole="tab" accessibilityLabel={`${value} días`} accessibilityState={{ selected: period === value }}
          style={[styles.rangeItem, period === value && styles.rangeOn]} onPress={() => setPeriod(value)}>
          <Text variant="bodyStrong" tone={period === value ? 'onPrimary' : 'primary'} style={[styles.rangeText, period === value && { fontFamily: font.semibold }]}>{value} días</Text>
        </TouchableOpacity>)}
      </View>
    </View>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card padding="none" style={styles.card}>
        <View style={styles.titleRow}>
          <Text variant="heading">Calorías</Text>
          <Text variant="caption" tone="secondary">meta {formatCalories(targets.targetCalories)}</Text>
        </View>
        <View style={styles.figure}>
          <Text variant="numberMedium">{range.calories === null ? '—' : formatCalories(range.calories)}</Text>
          <Text variant="caption" tone="secondary">kcal por día registrado</Text>
        </View>
        <CalorieChart buckets={buckets} period={period} goal={targets.targetCalories} today={end} onOpen={date => onOpen(date, false)} />
        <Text variant="caption" tone="secondary">{range.recordedDays ? period === 7 ? 'Los días sin registro no cuentan en el promedio.' : 'Cada barra es el promedio de los días registrados de ese tramo.' : 'Sin alimentos registrados en este período.'}</Text>
      </Card>

      {weightOn ? <Card padding="none" style={[styles.card, { gap: 10 }]}>
        <TouchableOpacity accessibilityRole="button" disabled={!latest}
          accessibilityLabel={latest ? `Peso: ${kg(latest.kg)} kilos${delta === null ? '' : delta === 0 ? `, sin cambio en ${period} días` : `, ${delta < 0 ? 'baja' : 'sube'} ${kg(Math.abs(delta))} en ${period} días`}` : 'Peso sin registros en este período'}
          accessibilityHint="Abre Mediciones" onPress={() => latest && onOpen(latest.date, true)} style={{ gap: 10 }}>
          <View style={styles.titleRow}>
            <Text variant="heading">Peso</Text>
            {delta !== null ? <Text variant="caption" tone="secondary">{delta > 0 ? '+' : delta < 0 ? '−' : ''}{kg(Math.abs(delta))} kg en {period} días</Text> : null}
          </View>
          {latest ? <>
            <View style={styles.figure}>
              <Text variant="numberMedium">{kg(latest.kg)}</Text>
              <Text variant="caption" tone="secondary">{latest.date === end ? 'kg hoy' : `kg el ${shortDate(latest.date)}`}</Text>
            </View>
            <WeightLine points={range.weights} />
          </> : <Text tone="secondary">Sin pesos en este período.</Text>}
        </TouchableOpacity>
      </Card> : null}

      <Card padding="none" style={styles.card}>
        <Text variant="heading">Macros promedio</Text>
        <MacroRow name="Proteína" value={range.protein} target={targets.targetProtein} tone="macroProtein" />
        <MacroRow name="Carbohidratos" value={range.carbs} target={targets.targetCarbs} tone="macroCarbs" />
        <MacroRow name="Grasa" value={range.fat} target={targets.targetFat} tone="macroFat" />
      </Card>
    </ScrollView>
  </View>;
}

function MacroRow({ name, value, target, tone }: { name: string; value: number | null; target: number; tone: 'macroProtein' | 'macroCarbs' | 'macroFat' }) {
  const theme = useTheme();
  const styles = useStyles();
  return <View style={styles.macroRow} accessible accessibilityLabel={`${name}: ${value === null ? 'sin datos' : `${formatMacroGrams(value)} de ${formatMacroGrams(target)} gramos en promedio`}`}>
    <Text style={styles.macroName}>{name}</Text>
    <View style={{ flex: 1 }}><ProgressBar value={value === null || !target ? 0 : value / target} color={theme.colors[tone]} /></View>
    <Text style={styles.macroValue} numberOfLines={1}>
      <Text variant="number" style={{ fontSize: 14 }}>{value === null ? '—' : formatMacroGrams(Math.round(value))}</Text>
      <Text tone="secondary" style={{ fontSize: 14 }}> / {formatMacroGrams(target)} g</Text>
    </Text>
  </View>;
}

const CHART = 120, SCALE = CHART - 32;

function CalorieChart({ buckets, period, goal, today, onOpen }: { buckets: Bucket[]; period: number; goal: number; today: string; onOpen: (date: string) => void }) {
  const theme = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const labels = buckets.map((bucket, i) => {
    if (period === 7) return LETTERS[parseDateId(bucket.start).getUTCDay()];
    if (period === 30) return i % 3 === 0 ? String(parseDateId(bucket.start).getUTCDate()) : '';
    return i === 0 || month(bucket.start) !== month(buckets[i - 1].start) ? month(bucket.start) : '';
  });
  const describe = (bucket: Bucket) => {
    const when = bucket.start === bucket.end ? `${DAY_NAMES[parseDateId(bucket.start).getUTCDay()]} ${shortDate(bucket.start)}` : `${shortDate(bucket.start)} al ${shortDate(bucket.end)}`;
    return bucket.average === null ? `${when}: sin registros` : `${when}: ${formatCalories(bucket.average)} kilocalorías${bucket.start === bucket.end ? '' : ' en promedio'}`;
  };
  const dashes = width ? Math.floor(width / 8) : 0;
  return <View>
    <View style={[styles.chart, { height: CHART }]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" style={[styles.goal, { bottom: SCALE }]}>
        {Array.from({ length: dashes }, (_, i) => <View key={i} style={[styles.dash, { backgroundColor: theme.colors.goal }]} />)}
      </View>
      {buckets.map(bucket => {
        const current = period === 7 && bucket.start === today;
        const ratio = goal > 0 && bucket.average !== null ? bucket.average / goal : 0;
        const h = bucket.average === null ? 4 : Math.max(4, Math.min(CHART, Math.round(ratio * SCALE)));
        // A single day opens even without records (to log it); a multi-day bucket opens its latest recorded day.
        const target = period === 7 ? bucket.start : bucket.latestRecorded;
        return <TouchableOpacity key={bucket.start} accessibilityRole="button" accessibilityLabel={describe(bucket)} accessibilityHint={target ? 'Abre ese día en el diario' : undefined}
          disabled={!target} onPress={() => target && onOpen(target)} hitSlop={{ left: 4, right: 4 }} style={styles.barSlot}>
          <View style={[styles.bar, { height: h, backgroundColor: bucket.average === null ? theme.colors.barEmpty : current ? theme.colors.primary : theme.colors.bar }]} />
        </TouchableOpacity>;
      })}
    </View>
    {/* Labels are centred under their bar but may be wider than it (12 bars on a narrow phone). */}
    <View style={styles.axis} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {width ? labels.map((label, i) => {
        const slot = (width - 10 * (labels.length - 1)) / labels.length;
        return label ? <Text key={i} variant="label" tone="secondary" numberOfLines={1}
          style={[styles.axisLabel, { left: i * (slot + 10) + slot / 2 - 20 }]}>{label}</Text> : null;
      }) : null}
    </View>
  </View>;
}

const LINE_H = 70;

function WeightLine({ points }: { points: { date: string; kg: number }[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const values = points.map(p => p.kg);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => ({ x: 4 + (points.length > 1 ? i / (points.length - 1) : 1) * Math.max(0, width - 8), y: 8 + (hi - p.kg) / span * (LINE_H - 16) }));
  const color = theme.colors.macroProtein;
  return <View style={{ height: LINE_H }} onLayout={event => setWidth(event.nativeEvent.layout.width)} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    {width ? xy.slice(1).map((b, i) => {
      const a = xy[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: (a.x + b.x) / 2 - length / 2, top: (a.y + b.y) / 2 - 1.5, width: length, height: 3, borderRadius: 1.5,
        backgroundColor: color, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
    }) : null}
    {width && xy.length ? <View pointerEvents="none" style={{ position: 'absolute', left: xy.at(-1)!.x - 5, top: xy.at(-1)!.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
  </View>;
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1 },
  header: { paddingTop: t.space.lg, paddingHorizontal: t.space.xl, paddingBottom: t.space.md, gap: t.space.md },
  range: { flexDirection: 'row', borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surface },
  rangeItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  rangeOn: { backgroundColor: t.colors.primary },
  rangeText: { fontSize: 14 },
  content: { paddingHorizontal: t.space.xl, paddingBottom: t.space.md, gap: t.space.md },
  card: { padding: 18, gap: t.space.md },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: t.space.sm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  goal: { position: 'absolute', left: 0, right: 0, height: 2, flexDirection: 'row', justifyContent: 'space-between', overflow: 'hidden' },
  dash: { width: 5, height: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  axis: { height: 16, marginTop: t.space.md },
  axisLabel: { position: 'absolute', top: 0, width: 40, textAlign: 'center', fontFamily: font.regular },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  macroRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  macroName: { width: 104, fontSize: 14 },
  macroValue: { width: 84, textAlign: 'right' },
}));
