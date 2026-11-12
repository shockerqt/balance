import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Field, Icon, Input, Screen, Sheet, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useMealStore } from '@/hooks/use-meal-store';
import { useMealReceipt } from '@/hooks/use-meal-receipt';
import { logsDateStore } from '@/hooks/use-logs-date';
import { currentTimeString, displayDateFor, todayId } from '@/lib/dates';
import { frequentTemplates, personalTemplates, recentTemplates, searchTemplates } from '@/lib/food-recents';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';
import { isDateId, type MealTemplateDoc } from '@/services/sync/types';
import { font, makeStyles, useTheme } from '@/theme';
import { createFoodEntry, decimal, nutrientFields } from './native/food-entry-contract';
import { ChoiceRow } from './choice-row';
import { CalendarMonth } from './calendar-month';

export default function ReactNativeFoodEntryScreen() {
  const { user, isGuest } = useAuth();
  return <FoodEntrySession key={user?.id ?? (isGuest ? 'guest' : 'anonymous')} />;
}

type Source = 'recent' | 'frequent' | 'mine';
/** One selected food. The id is fixed when it is selected, so a retried save writes the same documents. */
type Draft = { id: string; template: MealTemplateDoc; portionId: string; quantity: string };
const SOURCES: [Source, string][] = [['recent', 'Recientes'], ['frequent', 'Frecuentes'], ['mine', 'Mis alimentos']];
const unitName = (unit: string) => unit === 'ml' ? 'mililitros' : 'gramos';

function draftFor(template: MealTemplateDoc): Draft {
  const portion = template.details.portions[0];
  return { id: randomUUID(), template, portionId: portion?.id ?? '', quantity: portion ? '1' : '100' };
}
function canonical(template: MealTemplateDoc, portionId: string, quantity: number) {
  const portion = template.details.portions.find(p => p.id === portionId);
  return portion ? quantity * portion.canonicalQuantity / portion.portionQuantity : quantity;
}
function caloriesOf(draft: Draft) {
  const quantity = decimal(draft.quantity, true) ?? 0;
  return draft.template.details.nutritionPer100.calories * canonical(draft.template, draft.portionId, quantity) / 100;
}
function describe(template: MealTemplateDoc) {
  const portion = template.details.portions[0];
  const amount = portion ? portion.canonicalQuantity : 100;
  const n = template.details.nutritionPer100;
  const basis = portion ? `${formatMacroGrams(portion.portionQuantity)} ${portion.name}` : `100 ${template.details.canonicalUnit}`;
  return `${basis} · ${formatCalories(n.calories * amount / 100)} kcal · ${formatMacroGrams(n.protein * amount / 100)} g proteína`;
}

function FoodEntrySession() {
  const router = useRouter();
  const styles = useStyles();
  const params = useLocalSearchParams<{ dateId?: string; time?: string }>();
  const library = useFoodLibraryStore();
  const meals = useMealStore();
  const liveTemplates = useRef(library.templateDocuments);
  useLayoutEffect(() => { liveTemplates.current = library.templateDocuments; }, [library.templateDocuments]);
  const [documentId] = useState(randomUUID);
  const [date, setDate] = useState(() => typeof params.dateId === 'string' && isDateId(params.dateId) ? params.dateId : todayId());
  const [time, setTime] = useState(() => typeof params.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : currentTimeString());
  const [mode, setMode] = useState<'library' | 'custom'>('library');
  const [when, setWhen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('recent');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Custom food form
  const [quantity, setQuantity] = useState('100');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'g' | 'ml'>('g');
  const [basis, setBasis] = useState<'per100' | 'portion'>('per100');
  const [labelSize, setLabelSize] = useState('');
  const [nutrients, setNutrients] = useState<Record<string, string>>({});
  const [extended, setExtended] = useState(false);
  const receipt = useMealReceipt(() => { logsDateStore.set(date); router.back(); });
  const disabled = receipt.saving || receipt.saved;

  const now = useMemo(() => Date.now(), []);
  const recents = useMemo(() => recentTemplates(meals.mealDocuments, library.templateDocuments, now), [meals.mealDocuments, library.templateDocuments, now]);
  const list = useMemo(() => {
    if (query.trim()) return searchTemplates(library.templateDocuments, query);
    if (source === 'frequent') return frequentTemplates(meals.mealDocuments, library.templateDocuments, now);
    if (source === 'mine') return personalTemplates(library.templateDocuments);
    return recents.length ? recents : searchTemplates(library.templateDocuments, '');
  }, [query, source, recents, library.templateDocuments, meals.mealDocuments, now]);
  const selectedIds = new Set(drafts.map(d => d.template.id));
  const rows = [...drafts.map(d => d.template), ...list.filter(t => !selectedIds.has(t.id))];
  const total = drafts.reduce((sum, d) => sum + caloriesOf(d), 0);

  const toggle = (template: MealTemplateDoc) => {
    if (disabled) return;
    setDrafts(current => current.some(d => d.template.id === template.id) ? current.filter(d => d.template.id !== template.id) : [...current, draftFor(template)]);
  };
  const update = (templateId: string, patch: Partial<Draft>) => setDrafts(current => current.map(d => d.template.id === templateId ? { ...d, ...patch } : d));

  const customInput = { date, time, quantity, name, unit, labelBasis: basis, labelSize, nutrients };
  const saveLibrary = () => receipt.submit(JSON.stringify({ date, time, drafts: drafts.map(d => [d.id, d.template.id, d.template.updatedAt, d.portionId, d.quantity]) }),
    () => drafts.map(d => createFoodEntry({ date, time, quantity: d.quantity, templateId: d.template.id, templateRevision: d.template.updatedAt, portionId: d.portionId }, liveTemplates.current, d.id)),
    () => {
      if (!drafts.length) throw new Error('Elige al menos un alimento.');
      if (!drafts.every(d => liveTemplates.current.some(t => !t._deleted && t.id === d.template.id && t.updatedAt === d.template.updatedAt)))
        throw new Error('Un alimento cambió en la biblioteca. Quítalo y vuelve a elegirlo.');
    });
  const saveCustom = () => receipt.submit(JSON.stringify(customInput), () => [createFoodEntry(customInput, liveTemplates.current, documentId)]);

  const whenPanel = when ? <View style={styles.when}>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Field label="Fecha" style={{ flex: 1 }}><Input accessibilityLabel="Fecha del alimento" value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" editable={!disabled} /></Field>
      <Field label="Hora" style={{ flex: 1 }}><Input accessibilityLabel="Hora del alimento" value={time} onChangeText={setTime} placeholder="HH:MM" maxLength={5} editable={!disabled} /></Field>
    </View>
    <Button title={calendar ? 'Ocultar calendario' : 'Elegir en el calendario'} variant="ghost" size="md" disabled={disabled} onPress={() => setCalendar(!calendar)} />
    {calendar ? <CalendarMonth value={date} onChange={value => { setDate(value); setCalendar(false); }} disabled={disabled} /> : null}
  </View> : null;

  const timeButton = <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Cambiar fecha y hora, ahora ${time}`} accessibilityState={{ expanded: when }}
    style={styles.timeButton} onPress={() => setWhen(!when)}>
    <Icon name="clock" size={16} tone="primary" />
    <Text variant="number">{time}</Text>
  </TouchableOpacity>;

  const footer = mode === 'library'
    ? <View style={{ gap: 8 }}>
      {receipt.error ? <Text selectable tone="danger" accessibilityRole="alert">{receipt.error}</Text> : null}
      <View style={styles.footerRow}>
        <View style={{ flex: 1, minWidth: 0 }} accessibilityLiveRegion="polite">
          <Text variant="heading">{drafts.length} {drafts.length === 1 ? 'alimento' : 'alimentos'}</Text>
          <Text variant="caption" tone="secondary">{formatCalories(total)} kcal a las {time}</Text>
        </View>
        <Button title="Guardar" loading={receipt.saving} disabled={receipt.saved || !drafts.length || !library.isLibraryReady} onPress={saveLibrary} />
      </View>
    </View>
    : <View style={{ gap: 8 }}>{receipt.error ? <Text selectable tone="danger" accessibilityRole="alert">{receipt.error}</Text> : null}
      <Button title="Registrar alimento" loading={receipt.saving} disabled={receipt.saved} onPress={saveCustom} /></View>;

  return <Screen edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Sheet title={mode === 'library' ? 'Agregar' : 'Alimento nuevo'} subtitle={date === todayId() ? 'Hoy' : displayDateFor(date)}
        closeLabel="Cancelar" onClose={() => { if (!disabled) router.back(); }} action={timeButton} footer={footer}>
        {mode === 'library' ? <>
          <View style={styles.controls}>
            {whenPanel}
            <View style={styles.search}>
              <Icon name="search" size={18} tone="secondary" />
              <SearchInput value={query} onChange={setQuery} editable={!disabled} />
            </View>
            <View style={styles.chips} accessibilityRole="tablist">
              {SOURCES.map(([value, label]) => {
                const active = !query.trim() && source === value;
                return <TouchableOpacity key={value} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipOn]} onPress={() => { setQuery(''); setSource(value); }}>
                  <Text variant="bodyStrong" tone={active ? 'onPrimary' : 'primary'} style={[styles.chipText, active && { fontFamily: font.semibold }]}>{label}</Text>
                </TouchableOpacity>;
              })}
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}>
            {!library.isLibraryReady ? <Text tone="secondary">Cargando biblioteca…</Text> : rows.length ? <View style={styles.list}>
              {rows.map((template, index) => {
                const draft = drafts.find(d => d.template.id === template.id);
                return <FoodRow key={template.id} template={template} draft={draft} first={index === 0} disabled={disabled}
                  onToggle={() => toggle(template)} onChange={patch => update(template.id, patch)} />;
              })}
            </View> : <Text tone="secondary">{query.trim() ? `Sin resultados para «${query.trim()}».` : source === 'mine' ? 'Aún no tienes alimentos propios.' : 'Aún no hay registros de la biblioteca en este período.'}</Text>}
            {source === 'recent' && !query.trim() && !recents.length && rows.length ? <Text variant="caption" tone="secondary">Sin recientes todavía: se muestra la biblioteca.</Text> : null}
            <Button title="Crear alimento nuevo" variant="ghost" size="md" disabled={disabled} onPress={() => setMode('custom')} />
          </ScrollView>
        </> : <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 18 }}>
          {whenPanel}
          <Button title="Elegir de la biblioteca" variant="ghost" size="md" disabled={disabled} onPress={() => setMode('library')} />
          <Field label="Nombre"><Input accessibilityLabel="Nombre del alimento" value={name} onChangeText={setName} maxLength={160} editable={!disabled} /></Field>
          <ChoiceRow values={['Gramos (g)', 'Mililitros (ml)']} selected={unit === 'g' ? 0 : 1} disabled={disabled} onChange={i => setUnit(i === 0 ? 'g' : 'ml')} />
          <Field label={`Cantidad consumida (${unit})`}>
            <Input accessibilityLabel="Cantidad consumida" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" editable={!disabled} emphasis />
          </Field>
          <ChoiceRow values={[`Etiqueta por 100 ${unit}`, 'Etiqueta por porción']} selected={basis === 'per100' ? 0 : 1} disabled={disabled} onChange={i => setBasis(i === 0 ? 'per100' : 'portion')} />
          {basis === 'portion' ? <Field label={`Tamaño de la porción de la etiqueta (${unit})`}><Input accessibilityLabel="Tamaño de la porción de la etiqueta" value={labelSize} onChangeText={setLabelSize} keyboardType="decimal-pad" editable={!disabled} /></Field> : null}
          <Text tone="secondary">Deja vacíos los nutrientes que no conoces. Cero significa que la etiqueta declara cero.</Text>
          {nutrientFields.filter((_, i) => extended || i < 7).map(field => <Field key={field.key} label={`${field.label} (${field.unit})${field.required ? ' · obligatorio' : ''}`}>
            <Input accessibilityLabel={field.label} keyboardType="decimal-pad" value={nutrients[field.key] ?? ''} editable={!disabled}
              onChangeText={value => setNutrients(previous => ({ ...previous, [field.key]: value }))} />
          </Field>)}
          <Button title={extended ? 'Ocultar otros nutrientes' : 'Otros nutrientes'} size="md" variant="ghost" disabled={disabled} onPress={() => setExtended(!extended)} />
        </ScrollView>}
      </Sheet>
    </KeyboardAvoidingView>
  </Screen>;
}

function SearchInput({ value, onChange, editable }: { value: string; onChange: (value: string) => void; editable: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  return <TextInput accessibilityLabel="Buscar alimento" placeholder="Buscar alimento" placeholderTextColor={theme.colors.textSecondary}
    selectionColor={theme.colors.focus} value={value} onChangeText={onChange} editable={editable} autoCorrect={false} style={styles.searchInput} />;
}

function FoodRow({ template, draft, first, disabled, onToggle, onChange }: {
  template: MealTemplateDoc; draft?: Draft; first: boolean; disabled: boolean; onToggle: () => void; onChange: (patch: Partial<Draft>) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const portion = draft ? template.details.portions.find(p => p.id === draft.portionId) : undefined;
  const step = portion ? 1 : 10;
  const amount = draft ? decimal(draft.quantity, true) ?? 0 : 0;
  const units: [string, string][] = [...template.details.portions.slice(0, 1).map(p => [p.id, p.name] as [string, string]), ['', unitName(template.details.canonicalUnit)]];
  const toggleButton = <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${draft ? 'Quitar' : 'Agregar'} ${template.name}`} disabled={disabled}
    style={[styles.toggle, draft ? styles.toggleOn : null]} onPress={onToggle}>
    <Icon name={draft ? 'check' : 'plus'} size={18} tone={draft ? 'onPrimary' : 'primary'} />
  </TouchableOpacity>;
  return <View style={[styles.row, !first && styles.divider, draft ? styles.rowSelected : null]}>
    <View style={styles.rowTop}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={draft ? { fontFamily: font.semibold } : null}>{template.name}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>{draft ? `${formatCalories(caloriesOf(draft))} kcal · ${formatMacroGrams(template.details.nutritionPer100.protein * canonical(template, draft.portionId, amount) / 100)} g proteína` : describe(template)}</Text>
      </View>
      {toggleButton}
    </View>
    {draft ? <View style={styles.quantityRow}>
      <View style={styles.stepper}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Menos ${template.name}`} disabled={disabled || amount <= step}
          style={[styles.stepButton, amount <= step && { opacity: 0.4 }]} onPress={() => onChange({ quantity: String(Math.max(step, Math.round((amount - step) * 100) / 100)) })}>
          <Text style={styles.stepGlyph}>−</Text>
        </TouchableOpacity>
        <TextInput accessibilityLabel={`Cantidad de ${template.name}`} value={draft.quantity} keyboardType="decimal-pad" editable={!disabled}
          selectionColor={theme.colors.focus} onChangeText={quantity => onChange({ quantity })} style={styles.stepValue} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Más ${template.name}`} disabled={disabled}
          style={styles.stepButton} onPress={() => onChange({ quantity: String(Math.round((amount + step) * 100) / 100) })}>
          <Text style={styles.stepGlyph}>+</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.units} accessibilityRole="radiogroup" accessibilityLabel={`Unidad de ${template.name}`}>
        {units.map(([id, label]) => {
          const on = draft.portionId === id;
          return <TouchableOpacity key={id || 'canonical'} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} disabled={disabled}
            style={[styles.unit, on && styles.unitOn]} onPress={() => { if (!on) onChange({ portionId: id, quantity: id ? '1' : '100' }); }}>
            <Text variant={on ? 'heading' : 'bodyStrong'} tone={on ? 'primary' : 'secondary'} numberOfLines={1} style={styles.unitText}>{label}</Text>
          </TouchableOpacity>;
        })}
      </View>
    </View> : null}
  </View>;
}

const useStyles = makeStyles((t) => ({
  controls: { paddingHorizontal: t.space.xl, gap: t.space.md },
  when: { gap: t.space.md, paddingBottom: t.space.xs },
  timeButton: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: t.space.sm, backgroundColor: t.colors.surface,
    borderWidth: t.border.hairline, borderColor: t.colors.border, borderRadius: t.radius.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 14, backgroundColor: t.colors.surface,
    borderWidth: t.border.hairline, borderColor: t.colors.text, borderRadius: t.radius.lg, overflow: 'hidden' },
  searchInput: { flex: 1, minWidth: 0, height: 44, padding: 0, color: t.colors.text, fontFamily: font.regular, fontSize: 15 },
  chips: { flexDirection: 'row', gap: t.space.sm },
  chip: { minHeight: 44, paddingHorizontal: 13, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, overflow: 'hidden' },
  chipOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  chipText: { fontSize: 14 },
  listContent: { paddingHorizontal: t.space.xl, paddingTop: 14, paddingBottom: t.space.xl, gap: 6 },
  list: { backgroundColor: t.colors.surface, borderWidth: t.border.hairline, borderColor: t.colors.border, borderRadius: t.radius.lg, paddingHorizontal: 14 },
  row: { minHeight: 60, justifyContent: 'center' },
  rowSelected: { paddingVertical: t.space.md, gap: t.space.md },
  divider: { borderTopWidth: t.border.hairline, borderTopColor: t.colors.track },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  toggle: { width: 44, height: 44, borderRadius: t.radius.md, borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  toggleOn: { backgroundColor: t.colors.primary, borderColor: t.colors.primary },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, borderRadius: t.radius.md, overflow: 'hidden' },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { fontFamily: font.regular, fontSize: 20, lineHeight: 24, color: t.colors.text },
  stepValue: { minWidth: 36, maxWidth: 64, padding: 0, textAlign: 'center', color: t.colors.text, fontFamily: font.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
  units: { flex: 1, flexDirection: 'row', borderWidth: t.border.hairline, borderColor: t.colors.lineStrong, borderRadius: t.radius.md, overflow: 'hidden' },
  unit: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unitOn: { backgroundColor: t.colors.track },
  unitText: { fontSize: 14 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
}));
