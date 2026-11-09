import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { scaleNutrition } from '@balance/domain';
import { Button, Card, Field, Input, Sheet, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useMealStore } from '@/hooks/use-meal-store';
import { useMealReceipt } from '@/hooks/use-meal-receipt';
import { epochForChileDateTime, chileDateParts } from '@/lib/dates';
import { updateMealLogQuantityAndTime } from '@/lib/food-portions';
import { isMealLogDoc } from '@/services/sync/types';
import { decimal, nutrientFields } from './native/food-entry-contract';
import { selectionSources } from './selection-sources';
import { ChoiceRow } from './choice-row';

export default function ReactNativeFoodEditScreen() {
  const { user, isGuest } = useAuth();
  return <EditSession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}
function EditSession() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; foodId?: string }>();
  const meals = useMealStore();
  const liveDocuments = useRef(meals.mealDocuments);
  const active = useRef(false);
  const generation = useRef(0);
  useLayoutEffect(() => { liveDocuments.current = meals.mealDocuments; }, [meals.mealDocuments]);
  useFocusEffect(useCallback(() => { active.current = true; generation.current++; return () => { active.current = false; generation.current++; }; }, []));
  const [source] = useState(() => meals.mealDocuments.find(doc => doc.id === params.foodId && !doc._deleted));
  const date = params.dateId ?? '';
  const [quantity, setQuantity] = useState(() => source ? String(source.entry.enteredQuantity) : '');
  const [mode, setMode] = useState<'portion' | 'canonical'>(() => source?.entry.portionSnapshot ? 'portion' : 'canonical');
  const [time, setTime] = useState(() => {
    if (!source) return '';
    const p = chileDateParts(source.consumedAt);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  });
  const receipt = useMealReceipt(() => router.back());
  if (!source) return <Sheet title="Editar registro"><Text tone="secondary">El registro ya no está disponible. Vuelve al diario.</Text></Sheet>;
  const current = () => selectionSources(liveDocuments.current, date, [source.id], { [source.id]: source.updatedAt });
  const unit = source.nutritionSnapshot.canonicalUnit;
  const prepare = () => {
    current();
    const consumedAt = epochForChileDateTime(date, time);
    if (consumedAt === null || consumedAt <= 0 || decimal(quantity, true) === null) throw new Error('Revisa la cantidad y la hora de Chile.');
    const portion = `${quantity.trim().replace(',', '.')}${mode === 'portion' ? ` ${source.entry.portionSnapshot!.name}` : unit}`;
    const doc = updateMealLogQuantityAndTime(source, portion, consumedAt, Math.max(Date.now(), source.updatedAt + 1));
    if (!doc || !isMealLogDoc(doc)) throw new Error('La cantidad no es válida.');
    const scaled = scaleNutrition(doc.nutritionSnapshot.nutritionPer100, doc.canonicalQuantity / 100);
    if (Object.values(scaled).flatMap(value => value && typeof value === 'object' ? Object.values(value) : [value]).some(value => typeof value === 'number' && !Number.isFinite(value)))
      throw new Error('La cantidad es demasiado grande.');
    return [doc];
  };
  const remove = () => {
    if (receipt.saving || receipt.saved) return;
    const expectedGeneration = generation.current;
    Alert.alert('Eliminar registro', source.nameSnapshot, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => {
      if (!active.current || generation.current !== expectedGeneration) return;
      try { current(); meals.deleteFood(date, source.id); router.back(); } catch { Alert.alert('El registro cambió', 'Vuelve al diario antes de eliminarlo.'); }
    } }]);
  };
  const original = scaleNutrition(source.nutritionSnapshot.nutritionPer100, source.canonicalQuantity / 100);
  return <Sheet title="Editar registro" subtitle={source.nameSnapshot} closeLabel="Cancelar" onClose={() => { if (!receipt.saving) router.back(); }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 18 }}>
      <Field label="Hora"><Input accessibilityLabel="Hora del registro" value={time} onChangeText={setTime} maxLength={5} editable={!receipt.saving} /></Field>
      {source.entry.portionSnapshot ? <ChoiceRow values={[source.entry.portionSnapshot.name, unit]} selected={mode === 'portion' ? 0 : 1} disabled={receipt.saving} onChange={i => {
        setMode(i === 0 ? 'portion' : 'canonical'); setQuantity(String(i === 0 ? source.entry.enteredQuantity : source.canonicalQuantity));
      }} /> : null}
      <Field label={`Cantidad (${mode === 'portion' ? source.entry.portionSnapshot!.name : unit})`}>
        <Input accessibilityLabel="Cantidad del registro" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" emphasis editable={!receipt.saving} />
      </Field>
      <Card style={{ gap: 8 }}><Text variant="heading">Registro original</Text>
        {nutrientFields.slice(0, 7).map(field => { const value = (original as unknown as Record<string, unknown>)[field.key]; return <Text key={field.key} selectable>{field.label}: {typeof value === 'number' ? `${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${field.unit}` : 'Sin datos'}</Text>; })}
      </Card>
      <Text variant="caption" tone="secondary">Se conserva la etiqueta histórica. Al cambiar la cantidad se recalculan sus totales.</Text>
      {receipt.error ? <Text selectable tone="danger" accessibilityRole="alert">{receipt.error}</Text> : null}
      <Button title="Guardar cambios" loading={receipt.saving} disabled={receipt.saved} onPress={() => receipt.submit(JSON.stringify({ time, quantity, mode }), prepare, () => { current(); })} />
      <Button title="Eliminar registro" variant="danger" disabled={receipt.saving || receipt.saved} onPress={remove} />
    </ScrollView>
  </Sheet>;
}
