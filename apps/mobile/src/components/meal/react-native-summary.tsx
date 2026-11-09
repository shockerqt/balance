import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button, Card, Text } from '@/components/ui';
import { useMealStore } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { dateIdToEpochDay, displayDateFor, shiftDateId, todayId } from '@/lib/dates';
import { useTheme } from '@/theme';
import { createInterfaceDaysProjector } from './native/interface-contract';
import { CalendarMonth } from './calendar-month';
import { ChoiceRow } from './choice-row';
import { PageHeader } from './page-header';

type RecordPoint = { date: string; values: number[] };
const number = (value: number) => value.toLocaleString('es-CL', { maximumFractionDigits: 1 });

export function ReactNativeSummary({ onOpen }: { onOpen: (date: string, body: boolean) => void }) {
  const meals = useMealStore();
  const weight = useWeightStore();
  const preferences = usePreferencesStore();
  const [body, setBody] = useState(false);
  const [period, setPeriod] = useState(7);
  const [end, setEnd] = useState(todayId);
  const [calendar, setCalendar] = useState(false);
  const projector = useMemo(createInterfaceDaysProjector, []);
  const days = useMemo(() => projector(meals.dayLogs, weight.weightsByDate, meals.mealDocuments), [projector, meals.dayLogs, meals.mealDocuments, weight.weightsByDate]);
  const start = shiftDateId(end, -(period - 1));
  const records = Object.entries(days).filter(([date, day]) => date >= start && date <= end && (body ? day.weightKg !== null : day.recorded)).sort(([a], [b]) => a.localeCompare(b));
  const energy = records.map(([date, day]) => ({ date, values: [day.totals.calories] }));
  const macros = records.map(([date, day]) => ({ date, values: [day.totals.protein, day.totals.carbs, day.totals.fat] }));
  const weights = records.map(([date, day]) => ({ date, values: [day.weightKg!] }));
  return <View style={{ flex: 1 }}>
    <PageHeader title="Resumen" subtitle="Tendencias de tus registros" />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 20 }}>
      <ChoiceRow values={['Alimentación', 'Cuerpo']} selected={body ? 1 : 0} onChange={i => setBody(i === 1)} />
      <ChoiceRow values={['7 días', '30 días', '90 días']} selected={[7, 30, 90].indexOf(period)} onChange={i => setPeriod([7, 30, 90][i])} />
      <Button title={`Hasta ${displayDateFor(end)}`} variant="ghost" size="md" onPress={() => setCalendar(!calendar)} />
      {calendar ? <CalendarMonth value={end} onChange={date => { setEnd(date); setCalendar(false); }} /> : null}
      {body && !preferences.weightTrackingEnabled ? <Text tone="secondary">Activa el seguimiento de peso en Perfil para consultar su evolución.</Text> : !records.length ?
        <Card><Text variant="heading">Sin registros en este período</Text><Text tone="secondary">Elige otras fechas o registra {body ? 'tu peso' : 'un alimento'}.</Text></Card> : body ?
          <TrendPlot title="Peso" unit="kg" labels={['Peso']} points={weights} start={start} end={end} joinGaps onOpen={date => onOpen(date, true)} /> : <>
            <TrendPlot title="Energía registrada" unit="kcal" labels={['Energía']} points={energy} start={start} end={end} bars onOpen={date => onOpen(date, false)} />
            <TrendPlot title="Macronutrientes" unit="g" labels={['Proteínas', 'Carbohidratos', 'Grasas']} points={macros} start={start} end={end} onOpen={date => onOpen(date, false)} />
          </>}
      <Text variant="caption" tone="secondary">{body ? 'La línea une mediciones reales según el tiempo transcurrido.' : 'Los días sin alimentos se muestran sin datos. Las curvas se interrumpen en esas fechas. Cero indica un valor registrado.'}</Text>
    </ScrollView>
  </View>;
}

function TrendPlot({ title, unit, labels, points, start, end, bars = false, joinGaps = false, onOpen }: {
  title: string; unit: string; labels: string[]; points: RecordPoint[]; start: string; end: string; bars?: boolean; joinGaps?: boolean; onOpen: (date: string) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(1);
  const [selected, setSelected] = useState('');
  const index = Math.max(0, points.findIndex(point => point.date === selected) < 0 ? points.length - 1 : points.findIndex(point => point.date === selected));
  const current = points[index];
  const bottom = joinGaps ? Math.min(...points.flatMap(p => p.values)) - .5 : 0;
  const top = Math.max(...points.flatMap(p => p.values), 1) + (joinGaps ? .5 : 0);
  const span = Math.max(1, dateIdToEpochDay(end) - dateIdToEpochDay(start));
  const x = (date: string) => 6 + (dateIdToEpochDay(date) - dateIdToEpochDay(start)) / span * Math.max(1, width - 12);
  const y = (value: number) => 126 - (value - bottom) / (top - bottom || 1) * 116;
  const colors = [theme.colors.primary, theme.colors.text, theme.colors.textMuted];
  const select = (location: number) => {
    const nearest = points.reduce((best, point) => Math.abs(x(point.date) - location) < Math.abs(x(best.date) - location) ? point : best, points[0]);
    setSelected(nearest.date);
  };
  return <Card style={{ gap: 12 }}>
    <Text variant="heading">{title}</Text>
    <Text selectable>{displayDateFor(current.date)} · {current.values.map((value, i) => `${labels.length > 1 ? `${labels[i]} ` : ''}${number(value)} ${unit}`).join(' · ')}</Text>
    <Text variant="caption" tone="muted">{number(top)} {unit}</Text>
    <Pressable onLayout={event => setWidth(event.nativeEvent.layout.width)} onPress={event => select(event.nativeEvent.locationX)}
      accessibilityRole="adjustable" accessibilityLabel={`${title}. ${current.date}. ${current.values.map((value, i) => `${labels[i]} ${number(value)} ${unit}`).join(', ')}`}
      accessibilityActions={[{ name: 'increment', label: 'Fecha siguiente' }, { name: 'decrement', label: 'Fecha anterior' }]}
      onAccessibilityAction={event => setSelected(points[Math.max(0, Math.min(points.length - 1, index + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))].date)}
      style={{ height: 140, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: x(current.date), width: 1, backgroundColor: theme.colors.border }} />
      {points.flatMap((point, p) => point.values.map((value, series) => {
        const left = x(point.date), height = 126 - y(value), previous = points[p - 1];
        const connected = previous && (joinGaps || dateIdToEpochDay(point.date) - dateIdToEpochDay(previous.date) === 1);
        const dx = previous ? left - x(previous.date) : 0;
        const dy = previous ? y(value) - y(previous.values[series]) : 0;
        const length = Math.hypot(dx, dy);
        return <React.Fragment key={`${point.date}:${series}`}>
          {bars ? <View pointerEvents="none" style={{ position: 'absolute', left: left - Math.max(2, width / span * .3), bottom: 14, width: Math.max(3, width / span * .6), height: Math.max(2, height), borderRadius: 3, backgroundColor: colors[series] }} /> : <>
            {connected ? <View pointerEvents="none" style={{ position: 'absolute', width: length, height: 2, left: (left + x(previous.date)) / 2 - length / 2,
              top: (y(value) + y(previous.values[series])) / 2, backgroundColor: colors[series], transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} /> : null}
            <View pointerEvents="none" style={{ position: 'absolute', left: left - 3, top: y(value) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors[series] }} />
          </>}
        </React.Fragment>;
      }))}
    </Pressable>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption" tone="muted">{displayDateFor(start)}</Text><Text variant="caption" tone="muted">{displayDateFor(end)}</Text></View>
    {labels.length > 1 ? <Text variant="caption" tone="secondary">{labels.join(' · ')}</Text> : null}
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button title="Anterior" size="md" variant="secondary" disabled={index === 0} onPress={() => setSelected(points[index - 1].date)} style={{ flex: 1, paddingHorizontal: 8 }} />
      <Button title="Siguiente" size="md" variant="secondary" disabled={index === points.length - 1} onPress={() => setSelected(points[index + 1].date)} style={{ flex: 1, paddingHorizontal: 8 }} />
    </View>
    <Button title="Abrir día seleccionado" size="md" variant="ghost" onPress={() => onOpen(current.date)} />
  </Card>;
}
