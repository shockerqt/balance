import React, { useLayoutEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useMealStore } from '@/hooks/use-meal-store';
import { useMealReceipt } from '@/hooks/use-meal-receipt';
import { epochForChileDateTime } from '@/lib/dates';
import { selectionSources } from './selection-sources';
import { ChoiceRow } from './choice-row';

const shortcuts = ['08:00', '11:00', '13:00', '16:00', '19:00', '21:00'];
export default function ReactNativeMoveScreen() {
  const { user, isGuest } = useAuth();
  return <MoveSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}
function MoveSession() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; ids?: string }>();
  const meals = useMealStore();
  const liveDocuments = useRef(meals.mealDocuments);
  useLayoutEffect(() => { liveDocuments.current = meals.mealDocuments; }, [meals.mealDocuments]);
  const [source] = useState(() => {
    const ids = (params.ids ?? '').split(',').filter(Boolean);
    return { date: params.dateId ?? '', ids, revisions: Object.fromEntries(meals.mealDocuments.filter(doc => ids.includes(doc.id)).map(doc => [doc.id, doc.updatedAt])) };
  });
  const [time, setTime] = useState('13:00');
  const receipt = useMealReceipt(() => router.back());
  const current = () => selectionSources(liveDocuments.current, source.date, source.ids, source.revisions);
  return <Sheet title="Mover a otra hora" subtitle={`${source.ids.length} registros`} closeLabel="Cancelar" onClose={() => { if (!receipt.saving) router.back(); }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
      <Field label="Nueva hora"><Input accessibilityLabel="Nueva hora" value={time} onChangeText={setTime} maxLength={5} editable={!receipt.saving} /></Field>
      <ChoiceRow values={shortcuts} selected={shortcuts.indexOf(time)} disabled={receipt.saving} onChange={i => setTime(shortcuts[i])} />
      {receipt.error ? <Text selectable tone="danger" accessibilityRole="alert">{receipt.error}</Text> : null}
      <Button title={`Mover a las ${time}`} loading={receipt.saving} disabled={receipt.saved} onPress={() => receipt.submit(time, () => {
        const consumedAt = epochForChileDateTime(source.date, time);
        if (consumedAt === null || consumedAt <= 0) throw new Error('Esa hora no existe en el horario de Chile.');
        return current().map(doc => ({ ...doc, consumedAt, updatedAt: Math.max(Date.now(), doc.updatedAt + 1) }));
      }, () => { current(); })} />
    </ScrollView>
  </Sheet>;
}
