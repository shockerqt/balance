import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Card, Sheet, Text } from '@/components/ui';
import { useMealStore } from '@/hooks/use-meal-store';
import { displayDateFor, todayId } from '@/lib/dates';
import { isDateId } from '@/services/sync/types';
import { projectInterfaceDays } from '@/components/meal/native/interface-contract';

export default function DayNutritionScreen() {
  const params = useLocalSearchParams<{ dateId?: string }>();
  const date = isDateId(params.dateId) ? params.dateId : todayId();
  const meals = useMealStore();
  const log = meals.dayLogs[date];
  const day = useMemo(() => log ? projectInterfaceDays({ [date]: log }, {}, meals.mealDocuments)[date] : null, [date, log, meals.mealDocuments]);
  return <Sheet title="Detalle nutricional" subtitle={displayDateFor(date)}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}>
      {!day?.recorded ? <Text tone="secondary">Sin alimentos registrados este día.</Text> : <Card style={{ gap: 16 }}>{day.details.map((detail, i) =>
        <View key={i} style={{ flexDirection: 'row', gap: 16, justifyContent: 'space-between' }}><Text style={{ flex: 1 }}>{detail.label}</Text>
          <Text selectable>{detail.value === null ? 'Sin datos' : `${detail.value.toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${detail.unit}${detail.partial ? ' · parcial' : ''}`}</Text>
        </View>)}</Card>}
      <Text variant="caption" tone="secondary">Sin datos significa desconocido. Un total parcial incluye solo los alimentos con ese nutriente declarado.</Text>
    </ScrollView>
  </Sheet>;
}
