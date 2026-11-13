import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PanResponder, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { displayDateFor, todayId } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { makeStyles } from '@/theme';
import { formatWeight, parseWeightInput, previousWeight } from '@/services/weight/weight';
import { isDateId } from '@/services/sync/types';

export default function WeightEntryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { dateId: dateParam } = useLocalSearchParams<{ dateId?: string }>();
  const dateId = isDateId(dateParam) ? dateParam : todayId();
  const { weightsByDate, saveWeight, deleteWeight } = useWeightStore();
  const { weightTrackingEnabled } = usePreferencesStore();
  const current = weightsByDate[dateId];
  const previous = previousWeight(weightsByDate, dateId);
  const seed = current?.weightGrams ?? previous?.weightGrams ?? 70000;
  const [value, setValue] = useState(formatWeight(seed));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFuture = dateId > todayId();
  const title = current ? 'Editar peso' : 'Registrar peso';
  const subtitle = useMemo(() => displayDateFor(dateId), [dateId]);

  useEffect(() => {
    if (!dirty) setValue(formatWeight(seed));
  }, [seed, dirty]);

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
  const deltaText = delta === null ? 'Primer registro' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatWeight(Math.abs(delta))} kg vs. ${displayDateFor(previous!.id)}`;

  const save = () => {
    const grams = parseWeightInput(value);
    if (grams === null) {
      setError('Ingresa un valor entre 1,0 y 500,0 kg usando un decimal.');
      return;
    }
    if (!saveWeight(dateId, grams)) {
      setError(
        weightTrackingEnabled
          ? 'No se puede registrar peso para esta fecha.'
          : 'El seguimiento de peso está desactivado en Configuración.'
      );
      return;
    }
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert('Eliminar peso', `Se quitará el registro de ${subtitle.toLowerCase()}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          deleteWeight(dateId);
          router.back();
        },
      },
    ]);
  };

  return (
    <Sheet title={title} subtitle={subtitle} closeLabel="Cancelar">
      <View style={styles.content}>
        <Text variant="caption" tone="secondary">PESO CORPORAL</Text>
        <Field label="Peso" hint="Precisión de 0,1 kg">
          <View style={styles.inputRow}>
            <Input
              accessibilityLabel="Peso en kilogramos"
              editable={editable}
              emphasis
              keyboardType="decimal-pad"
              maxLength={5}
              placeholder="72,4"
              selectTextOnFocus
              value={value}
              variant="number"
              onChangeText={(next) => {
                setValue(next);
                setDirty(true);
                setError(null);
              }}
            />
            <Text variant="heading" tone="secondary">
              kg
            </Text>
          </View>
        </Field>
        <Text tone="secondary" accessibilityLiveRegion="polite">{deltaText}</Text>
        <View {...ruler.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Peso, precisión de 0,1 kg"
          accessibilityValue={{ min: 1, max: 500, now: (draft ?? seed) / 1000, text: `${value} kg` }}
          accessibilityActions={[{ name: 'increment', label: 'Subir 0,1 kg' }, { name: 'decrement', label: 'Bajar 0,1 kg' }]}
          onAccessibilityAction={event => bounded(draftRef.current + (event.nativeEvent.actionName === 'increment' ? 100 : event.nativeEvent.actionName === 'decrement' ? -100 : 0))}
          style={styles.ruler}>
          {Array.from({ length: 31 }, (_, i) => <View key={i} style={[styles.tick, { height: i === 15 ? 44 : i % 5 === 0 ? 32 : 18 }]} />)}
        </View>
        <View style={styles.actions}>
          {[-1000, -100, 100, 1000].map(step => <Button key={step} title={`${step > 0 ? '+' : '−'}${formatWeight(Math.abs(step))}`}
            variant="secondary" size="md" disabled={!editable} style={styles.grow} onPress={() => bounded(draftRef.current + step)} />)}
        </View>
        {error ? (
          <Text tone="danger" selectable>
            {error}
          </Text>
        ) : null}
        {isFuture ? <Text tone="danger">Las fechas futuras no admiten registros.</Text> : null}
        <View style={styles.actions}>
          <Button title="Guardar peso" disabled={!editable} style={styles.grow} onPress={save} />
          {current ? <Button title="Eliminar" variant="danger" onPress={confirmDelete} /> : null}
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  ruler: { height: 72, borderRadius: 18, backgroundColor: t.colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', overflow: 'hidden' },
  tick: { width: 1, backgroundColor: t.colors.lineStrong },
  content: { padding: t.space.xl, gap: t.space.xl },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  grow: { flex: 1 },
}));
