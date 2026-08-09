import React, { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { displayDateFor, todayId } from '@/hooks/use-meal-store';
import { useWeightStore } from '@/hooks/use-weight-store';
import { usePreferencesStore } from '@/hooks/use-preferences-store';
import { makeStyles } from '@/theme';
import { formatWeight, parseWeightInput } from '@/services/weight/weight';
import { isDateId } from '@/services/sync/types';

export default function WeightEntryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { dateId: dateParam } = useLocalSearchParams<{ dateId?: string }>();
  const dateId = isDateId(dateParam) ? dateParam : todayId();
  const { weightsByDate, saveWeight, deleteWeight } = useWeightStore();
  const { weightTrackingEnabled } = usePreferencesStore();
  const current = weightsByDate[dateId];
  const [value, setValue] = useState(current ? formatWeight(current.weightGrams) : '');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFuture = dateId > todayId();
  const title = current ? 'Editar peso' : 'Registrar peso';
  const subtitle = useMemo(() => displayDateFor(dateId), [dateId]);

  useEffect(() => {
    if (!dirty) setValue(current ? formatWeight(current.weightGrams) : '');
  }, [current, dirty]);

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
        <Field label="Peso" hint="Precisión de 0,1 kg">
          <View style={styles.inputRow}>
            <Input
              accessibilityLabel="Peso en kilogramos"
              autoFocus
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
        {error ? (
          <Text tone="danger" selectable>
            {error}
          </Text>
        ) : null}
        {isFuture ? <Text tone="danger">Las fechas futuras no admiten registros.</Text> : null}
        <View style={styles.actions}>
          <Button title="Guardar peso" disabled={isFuture} style={styles.grow} onPress={save} />
          {current ? <Button title="Eliminar" variant="danger" onPress={confirmDelete} /> : null}
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, gap: t.space.xl },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  grow: { flex: 1 },
}));
