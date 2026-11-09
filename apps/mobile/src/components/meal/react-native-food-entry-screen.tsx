import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Card, Field, Input, Screen, Sheet, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useMealReceipt } from '@/hooks/use-meal-receipt';
import { logsDateStore } from '@/hooks/use-logs-date';
import { currentTimeString, todayId } from '@/lib/dates';
import { isDateId, type MealTemplateDoc } from '@/services/sync/types';
import { createFoodEntry, nutrientFields } from './native/food-entry-contract';
import { ChoiceRow } from './choice-row';
import { CalendarMonth } from './calendar-month';

export default function ReactNativeFoodEntryScreen() {
  const { user, isGuest } = useAuth();
  return <FoodEntrySession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}

function FoodEntrySession() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();
  const library = useFoodLibraryStore();
  const liveTemplates = useRef(library.templateDocuments);
  useLayoutEffect(() => { liveTemplates.current = library.templateDocuments; }, [library.templateDocuments]);
  const [documentId] = useState(randomUUID);
  const [date, setDate] = useState(() => typeof params.dateId === 'string' && isDateId(params.dateId) ? params.dateId : todayId());
  const [time, setTime] = useState(() => typeof params.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : currentTimeString());
  const [mode, setMode] = useState<'library' | 'custom'>('library');
  const [query, setQuery] = useState('');
  // Retain the chosen revision: live library changes must not silently alter a draft.
  const [template, setTemplate] = useState<MealTemplateDoc | null>(null);
  const [portionId, setPortionId] = useState('');
  const [quantity, setQuantity] = useState('100');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'g' | 'ml'>('g');
  const [basis, setBasis] = useState<'per100' | 'portion'>('per100');
  const [labelSize, setLabelSize] = useState('');
  const [nutrients, setNutrients] = useState<Record<string, string>>({});
  const [extended, setExtended] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const receipt = useMealReceipt(() => { logsDateStore.set(date); router.back(); });
  const input = mode === 'library'
    ? { date, time, quantity, templateId: template?.id ?? '', templateRevision: template?.updatedAt, portionId }
    : { date, time, quantity, name, unit, labelBasis: basis, labelSize, nutrients };
  const matches = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('es');
    return library.templateDocuments.filter(t => !t._deleted && (!text || t.name.toLocaleLowerCase('es').includes(text)));
  }, [library.templateDocuments, query]);
  const disabled = receipt.saving || receipt.saved;
  const save = () => receipt.submit(JSON.stringify(input), () => [createFoodEntry(input, liveTemplates.current, documentId)], () => {
    if (mode === 'library' && (!template || !liveTemplates.current.some(t => !t._deleted && t.id === template.id && t.updatedAt === template.updatedAt)))
      throw new Error('El alimento cambió. Vuelve a elegirlo en la biblioteca.');
  });
  const choose = (t: MealTemplateDoc) => { setTemplate(t); setPortionId(''); setQuantity('100'); };
  return <Screen edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Sheet title="Registrar alimento" closeLabel="Cancelar" onClose={() => { if (!disabled) router.back(); }}
        footer={<View style={{ gap: 8 }}>{receipt.error ? <Text selectable tone="danger" accessibilityRole="alert">{receipt.error}</Text> : null}
          <Button title="Registrar alimento" loading={receipt.saving} disabled={receipt.saved || (mode === 'library' && (!template || !library.isLibraryReady))} onPress={save} /></View>}>
        {mode === 'library' && !template ? <View style={{ flex: 1, paddingHorizontal: 20, gap: 10 }}>
          <ChoiceRow values={['Biblioteca', 'Alimento personalizado']} selected={0} disabled={disabled} onChange={i => setMode(i === 0 ? 'library' : 'custom')} />
          <Input accessibilityLabel="Buscar alimento" value={query} onChangeText={setQuery} placeholder="Buscar en la biblioteca" editable={!disabled} />
          <FlatList data={matches} keyExtractor={t => t.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24, gap: 8 }}
            ListEmptyComponent={<Text tone="secondary">{library.isLibraryReady ? 'Sin resultados. Puedes registrar un alimento personalizado.' : 'Cargando biblioteca…'}</Text>}
            renderItem={({ item }) => <Button title={item.name} variant="secondary" size="md" disabled={disabled} onPress={() => choose(item)} />} />
        </View> : <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 18 }}>
          <ChoiceRow values={['Biblioteca', 'Alimento personalizado']} selected={mode === 'library' ? 0 : 1} disabled={disabled} onChange={i => setMode(i === 0 ? 'library' : 'custom')} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Field label="Fecha" style={{ flex: 1 }}><Input accessibilityLabel="Fecha del alimento" value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" editable={!disabled} /></Field>
            <Field label="Hora" style={{ flex: 1 }}><Input accessibilityLabel="Hora del alimento" value={time} onChangeText={setTime} placeholder="HH:MM" maxLength={5} editable={!disabled} /></Field>
          </View>
          <Button title={calendar ? 'Ocultar calendario' : 'Elegir fecha'} variant="ghost" size="md" disabled={disabled} onPress={() => setCalendar(!calendar)} />
          {calendar ? <CalendarMonth value={date} onChange={value => { setDate(value); setCalendar(false); }} disabled={disabled} /> : null}
          {mode === 'library' && template ? <Card style={{ gap: 12 }}>
            <Text variant="heading">{template.name}</Text>
            <Button title="Cambiar alimento" variant="ghost" size="md" disabled={disabled} onPress={() => setTemplate(null)} />
            <ChoiceRow values={[template.details.canonicalUnit, ...template.details.portions.map(p => p.name)]}
              selected={portionId ? template.details.portions.findIndex(p => p.id === portionId) + 1 : 0} disabled={disabled}
              onChange={i => { setPortionId(i ? template.details.portions[i - 1].id : ''); setQuantity(i ? '1' : '100'); }} />
          </Card> : <>
            <Field label="Nombre"><Input accessibilityLabel="Nombre del alimento" value={name} onChangeText={setName} maxLength={160} editable={!disabled} /></Field>
            <ChoiceRow values={['Gramos (g)', 'Mililitros (ml)']} selected={unit === 'g' ? 0 : 1} disabled={disabled} onChange={i => setUnit(i === 0 ? 'g' : 'ml')} />
          </>}
          <Field label={`Cantidad consumida (${mode === 'library' && template ? portionId ? template.details.portions.find(p => p.id === portionId)?.name : template.details.canonicalUnit : unit})`}>
            <Input accessibilityLabel="Cantidad consumida" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" editable={!disabled} emphasis />
          </Field>
          {mode === 'custom' ? <>
            <ChoiceRow values={[`Etiqueta por 100 ${unit}`, 'Etiqueta por porción']} selected={basis === 'per100' ? 0 : 1} disabled={disabled} onChange={i => setBasis(i === 0 ? 'per100' : 'portion')} />
            {basis === 'portion' ? <Field label={`Tamaño de la porción de la etiqueta (${unit})`}><Input accessibilityLabel="Tamaño de la porción de la etiqueta" value={labelSize} onChangeText={setLabelSize} keyboardType="decimal-pad" editable={!disabled} /></Field> : null}
            <Text tone="secondary">Deja vacíos los nutrientes que no conoces. Cero significa que la etiqueta declara cero.</Text>
            {nutrientFields.filter((_, i) => extended || i < 7).map(field => <Field key={field.key} label={`${field.label} (${field.unit})${field.required ? ' · obligatorio' : ''}`}>
              <Input accessibilityLabel={field.label} keyboardType="decimal-pad" value={nutrients[field.key] ?? ''} editable={!disabled}
                onChangeText={value => setNutrients(previous => ({ ...previous, [field.key]: value }))} />
            </Field>)}
            <Button title={extended ? 'Ocultar otros nutrientes' : 'Otros nutrientes'} size="md" variant="ghost" disabled={disabled} onPress={() => setExtended(!extended)} />
          </> : null}
        </ScrollView>}
      </Sheet>
    </KeyboardAvoidingView>
  </Screen>;
}
