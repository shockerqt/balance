import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LoggedFoodItem, useMealStore } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { formatCalories, formatMacroGrams } from '@/lib/nutrition';

/* ============================================================
   Editar un registro.

   Un registro conserva el nombre y la nutricion que tenia cuando se
   creo. La edicion permite corregir solo su hora y porcion, que son
   los campos mutables del contrato de sincronizacion.
   ============================================================ */

export default function FoodEditScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { dateId, foodId } = useLocalSearchParams<{ dateId?: string; foodId?: string }>();

  const { dayLogs, selectedDateId, updateFood, deleteFood } = useMealStore();
  const targetDate = dateId || selectedDateId;

  const food = useMemo<LoggedFoodItem | undefined>(
    () => dayLogs[targetDate]?.foods.find((f) => f.id === foodId),
    [dayLogs, targetDate, foodId]
  );

  const [time, setTime] = useState(food?.time ?? '12:00');
  const [portion, setPortion] = useState(food?.portion ?? '');

  if (!food) return null;

  const save = () => {
    updateFood(targetDate, food.id, {
      time: time.trim() || food.time,
      portion: portion.trim() || food.portion,
    });
    router.back();
  };

  const remove = () => {
    deleteFood(targetDate, food.id);
    router.back();
  };

  return (
    <Sheet title="Editar registro" subtitle={food.name} closeLabel="Cancelar">
      <ScrollView
        contentContainerStyle={[styles.content, { gap: theme.space.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Field label="Hora" hint="Formato de 24 horas">
          <Input
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            placeholder="14:00"
          />
        </Field>

        <Field label="Porción">
          <Input value={portion} onChangeText={setPortion} placeholder="160 g" />
        </Field>

        <View style={[styles.snapshot, { gap: theme.space.sm }]}>
          <Text variant="label" tone="muted">
            Nutrición registrada
          </Text>
          <Text variant="number">
            {formatCalories(food.calories)} kcal · P {formatMacroGrams(food.protein)} g · C{' '}
            {formatMacroGrams(food.carbs)} g · G {formatMacroGrams(food.fat)} g
          </Text>
          <Text variant="caption" tone="secondary">
            La nutrición forma parte del snapshot histórico y no se modifica desde este registro.
          </Text>
        </View>

        <View style={[styles.actions, { gap: theme.space.sm }]}>
          <Button title="Guardar" onPress={save} style={styles.grow} />
          <Button title="Eliminar" variant="danger" onPress={remove} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, paddingBottom: t.space.xxxl },
  snapshot: {
    paddingVertical: t.space.lg,
    borderTopWidth: t.border.hairline,
    borderBottomWidth: t.border.hairline,
    borderColor: t.colors.border,
  },
  actions: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
}));
