import React, { useLayoutEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useMealStore } from '@/hooks/use-meal-store';
import { useMealReceipt } from '@/hooks/use-meal-receipt';
import { currentTimeString, todayId } from '@/lib/dates';
import { CalendarMonth } from './calendar-month';
import { prepareSelectionCopy } from './native/copy-selection-contract';
import { selectionSources } from './selection-sources';

export default function ReactNativeCopyScreen() {
  const { user, isGuest } = useAuth();
  return <CopySession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}
function CopySession() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; ids?: string; revisions?: string }>();
  const meals = useMealStore();
  const liveDocuments = useRef(meals.mealDocuments);
  useLayoutEffect(() => { liveDocuments.current = meals.mealDocuments; }, [meals.mealDocuments]);
  const [source] = useState(() => {
    const ids = (params.ids ?? '').split(',').filter(Boolean);
    let revisions: Record<string, number> = {};
    if (params.revisions) {
      try { const parsed = JSON.parse(params.revisions); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) revisions = parsed; } catch { /* contract reports invalid selection */ }
    } else revisions = Object.fromEntries(meals.mealDocuments.filter(doc => ids.includes(doc.id)).map(doc => [doc.id, doc.updatedAt]));
    return { sourceDate: params.dateId ?? '', ids, revisions };
  });
  const [operationId] = useState(randomUUID);
  const [date, setDate] = useState(todayId);
  const [time, setTime] = useState(currentTimeString);
  const [calendar, setCalendar] = useState(false);
  const receipt = useMealReceipt(() => router.back());
  const input = { ...source, operationId, destinationDate: date, time };
  return <Sheet title="Copiar registros" subtitle={`${source.ids.length} registros · conserva sus datos originales`} onClose={() => { if (!receipt.saving) router.back(); }} closeLabel="Cancelar">
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
      <Field label="Fecha de destino"><Input accessibilityLabel="Fecha de destino" value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" editable={!receipt.saving} /></Field>
      <Button title={calendar ? 'Ocultar calendario' : 'Elegir fecha'} size="md" variant="secondary" disabled={receipt.saving} onPress={() => setCalendar(!calendar)} />
      {calendar ? <CalendarMonth value={date} onChange={value => { setDate(value); setCalendar(false); }} disabled={receipt.saving} /> : null}
      <Field label="Hora de destino"><Input accessibilityLabel="Hora de destino" value={time} onChangeText={setTime} maxLength={5} placeholder="HH:MM" editable={!receipt.saving} /></Field>
      <Text tone="secondary">Los registros originales se mantienen en su día.</Text>
      {receipt.error ? <Text selectable accessibilityRole="alert" tone="danger">{receipt.error}</Text> : null}
      <Button title="Copiar registros" loading={receipt.saving} disabled={receipt.saved} onPress={() => receipt.submit(JSON.stringify(input),
        () => prepareSelectionCopy(input, liveDocuments.current, randomUUID).documents,
        () => { selectionSources(liveDocuments.current, source.sourceDate, source.ids, source.revisions); })} />
    </ScrollView>
  </Sheet>;
}
