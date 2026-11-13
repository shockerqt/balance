import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, PanResponder, Platform, ScrollView, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, Text } from '@/components/ui';
import { displayDateFor, todayId } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { MONTH_NAMES, parseDateId, shiftDateId } from '@/lib/dates';
import { font, makeStyles } from '@/theme';
import { formatWeight, parseWeightInput, previousWeight } from '@/services/weight/weight';
import { isDateId } from '@/services/sync/types';

export default function WeightEntryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const initialDetent = Math.min(0.9, Math.max(0.45, 426 * fontScale / Math.max(1, height)));
  const { dateId: dateParam } = useLocalSearchParams<{ dateId?: string }>();
  const dateId = isDateId(dateParam) ? dateParam : todayId();
  const { weightsByDate, saveWeight, deleteWeight } = useWeightStore();
  const { weightTrackingEnabled } = usePreferencesStore();
  const current = weightsByDate[dateId];
  const previous = previousWeight(weightsByDate, dateId);
  const seed = current?.weightGrams ?? previous?.weightGrams ?? 70000;
  const [value, setValue] = useState(formatWeight(seed));
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFuture = dateId > todayId();
  const title = current ? 'Editar peso' : 'Registrar peso';
  const subtitle = useMemo(() => displayDateFor(dateId).replace(', ', ' · '), [dateId]);

  useEffect(() => { if (!dirty) setValue(formatWeight(seed)); }, [seed, dirty]);
  const draft = parseWeightInput(value);
  const draftRef = useRef(draft ?? seed);
  draftRef.current = draft ?? seed;
  const editable = weightTrackingEnabled && !isFuture;
  const editableRef = useRef(editable); editableRef.current = editable;
  const bounded = useCallback((grams: number) => {
    if (!editableRef.current) return;
    const next = Math.max(1000, Math.min(500000, Math.round(grams / 100) * 100));
    setValue(formatWeight(next)); setDirty(true); setError(null);
  }, []);
  const drag = useRef<{ x: number; grams: number } | null>(null);
  const ruler = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => editableRef.current,
    onMoveShouldSetPanResponder: () => editableRef.current,
    onPanResponderGrant: event => { drag.current = { x: event.nativeEvent.pageX, grams: draftRef.current }; },
    onPanResponderMove: event => {
      if (drag.current) bounded(drag.current.grams + Math.round((drag.current.x - event.nativeEvent.pageX) / 10) * 100);
    },
    onPanResponderRelease: () => { drag.current = null; },
    onPanResponderTerminate: () => { drag.current = null; },
  }), [bounded]);
  const delta = draft !== null && previous ? draft - previous.weightGrams : null;
  const priorDate = previous ? parseDateId(previous.id) : null;
  const priorLabel = previous?.id === shiftDateId(todayId(), -1) ? 'ayer' : priorDate
    ? `${priorDate.getUTCDate()} ${MONTH_NAMES[priorDate.getUTCMonth()].slice(0, 3).toLocaleLowerCase('es')}` : '';
  const deltaText = delta === null ? 'Primer registro' : delta === 0
    ? `Igual que ${priorLabel} (${formatWeight(previous!.weightGrams)} kg)`
    : `${delta > 0 ? '+' : '−'}${formatWeight(Math.abs(delta))} kg vs. ${priorLabel} (${formatWeight(previous!.weightGrams)} kg)`;
  const centerKg = Math.round((draft ?? seed) / 1000);
  const trackOffset = (centerKg * 1000 - (draft ?? seed)) / 10;
  const integers = Array.from({ length: 7 }, (_, i) => centerKg - 3 + i).filter(kg => kg >= 1 && kg <= 500);

  const commitInput = () => {
    const grams = parseWeightInput(value);
    if (grams === null) { setError('Ingresa un valor entre 1,0 y 500,0 kg usando un decimal.'); return; }
    setValue(formatWeight(grams)); setEditing(false); setError(null);
  };
  const save = () => {
    const grams = parseWeightInput(value);
    if (grams === null) { setError('Ingresa un valor entre 1,0 y 500,0 kg usando un decimal.'); return; }
    if (!saveWeight(dateId, grams)) {
      setError(weightTrackingEnabled ? 'No se puede registrar peso para esta fecha.' : 'El seguimiento de peso está desactivado en Configuración.');
      return;
    }
    router.back();
  };
  const confirmDelete = () => Alert.alert('Eliminar peso', `Se quitará el registro de ${subtitle.toLowerCase()}.`, [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: () => { deleteWeight(dateId); router.back(); } },
  ]);

  return <>
    <Stack.Screen options={{ sheetAllowedDetents: [initialDetent, 0.95], sheetCornerRadius: 28, sheetGrabberVisible: false }} />
    <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.title}>{title}</Text><Text variant="caption" tone="secondary">{subtitle}</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancelar" style={styles.close} onPress={() => router.back()}><Icon name="x" size={18} tone="primary" /></TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          {editing ? <View style={styles.readout}>
            <Input accessibilityLabel="Peso en kilogramos" editable={editable} autoFocus keyboardType="decimal-pad" maxLength={5}
              selectTextOnFocus value={value} variant="number" style={styles.decimal} onBlur={commitInput} onSubmitEditing={commitInput}
              onChangeText={next => { setValue(next); setDirty(true); setError(null); }} />
            <Text style={styles.unit} tone="secondary">kg</Text>
          </View> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Peso ${value} kg, tocar para escribir`} disabled={!editable}
            style={[styles.readout, !editable && { opacity: 0.7 }]} onPress={() => setEditing(true)}>
            <Text style={styles.figure}>{value}</Text><Text style={styles.unit} tone="secondary">kg</Text>
          </TouchableOpacity>}
          <View style={styles.delta}><Text variant="caption" tone="secondary" numberOfLines={1} accessibilityLiveRegion="polite">{deltaText}</Text></View>
        </View>
        <View {...ruler.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Peso, precisión de 0,1 kg"
          accessibilityValue={{ min: 1, max: 500, now: (draft ?? seed) / 1000, text: `${value} kg` }}
          accessibilityActions={[{ name: 'increment', label: 'Subir 0,1 kg' }, { name: 'decrement', label: 'Bajar 0,1 kg' }]}
          onAccessibilityAction={event => bounded(draftRef.current + (event.nativeEvent.actionName === 'increment' ? 100 : event.nativeEvent.actionName === 'decrement' ? -100 : 0))}
          style={[styles.ruler, !editable && { opacity: 0.45 }]}>
          <View testID="weight-ruler-track" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.track, { transform: [{ translateX: trackOffset }] }]}>
            {integers.map(kg => <View key={kg} style={{ position: 'absolute', left: (kg - centerKg) * 100, top: 0, width: 100, height: 72 }}>
              {Array.from({ length: 10 }, (_, tenth) => tenth + kg * 10 <= 5000 ? <View key={tenth} style={[styles.tick, { left: tenth * 10 }, tenth === 0 ? styles.major : tenth === 5 ? styles.half : null]} /> : null)}
              <Text variant="label" tone="secondary" style={styles.rulerLabel}>{kg}</Text>
            </View>)}
          </View>
          <View testID="weight-ruler-needle" pointerEvents="none" style={styles.needle} />
        </View>
        <View style={styles.actions}>{[-1000, -100, 100, 1000].map(step => <Button key={step} title={`${step > 0 ? '+' : '−'}${formatWeight(Math.abs(step))}`}
          variant="secondary" size="md" disabled={!editable} style={styles.step} onPress={() => bounded(draftRef.current + step)} />)}</View>
        {error ? <Text variant="caption" tone="danger" selectable accessibilityRole="alert">{error}</Text> : null}
        {isFuture ? <Text variant="caption" tone="danger">Las fechas futuras no admiten registros.</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(22, insets.bottom) }]}>
        {current ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Eliminar" style={styles.delete} onPress={confirmDelete}><Text style={styles.deleteLabel}>Eliminar</Text></TouchableOpacity> : null}
        <Button title="Guardar peso" disabled={!editable} style={styles.grow} onPress={save} />
      </View>
    </KeyboardAvoidingView>
  </>;
}

const useStyles = makeStyles(t => ({
  sheet: { flex: 1, backgroundColor: t.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: t.colors.lineStrong, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, marginBottom: 14 },
  title: { fontFamily: font.titleSheet, fontSize: 19, lineHeight: 24 },
  close: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, gap: 14, paddingBottom: 4 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 4, paddingHorizontal: 12, borderBottomWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.lineStrong },
  figure: { fontFamily: font.semibold, fontSize: 48, lineHeight: 51, letterSpacing: -1.44, fontVariant: ['tabular-nums'] },
  decimal: { width: 152, minHeight: 0, borderWidth: 0, borderRadius: 0, padding: 0, backgroundColor: 'transparent', fontFamily: font.semibold, fontSize: 48, lineHeight: 51, letterSpacing: -1.44 },
  unit: { fontFamily: font.semibold, fontSize: 20, lineHeight: 24 },
  delta: { paddingVertical: 5, paddingHorizontal: 12, maxWidth: '100%', borderRadius: 999, backgroundColor: t.colors.track },
  ruler: { height: 72, borderRadius: 18, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.background, overflow: 'hidden' },
  track: { position: 'absolute', left: '50%', top: 0, bottom: 0 },
  tick: { position: 'absolute', top: 0, width: 1, height: 12, backgroundColor: t.colors.lineStrong },
  half: { width: 1.5, height: 20, backgroundColor: t.colors.bar },
  major: { width: 2, height: 28, backgroundColor: t.colors.primary },
  rulerLabel: { position: 'absolute', left: -40, top: 36, width: 80, textAlign: 'center', fontFamily: font.semibold },
  needle: { position: 'absolute', left: '50%', top: 0, width: 2.5, height: 34, borderRadius: 2, backgroundColor: t.colors.primary, transform: [{ translateX: -1.25 }] },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { flex: 1, backgroundColor: t.colors.background },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 12, paddingHorizontal: 20 },
  delete: { minHeight: 52, borderWidth: 1, borderColor: t.colors.lineStrong, borderRadius: 16, paddingHorizontal: 18, justifyContent: 'center' },
  deleteLabel: { fontFamily: font.semibold, fontSize: 15, color: t.colors.macroFat },
  grow: { flex: 1 },
}));
