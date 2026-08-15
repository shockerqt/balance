import React, { useMemo, useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LoggedFoodItem, useMealStore } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import { Button, Field, Icon, Input, Sheet, Text } from '@/components/ui';
import { formatCalories, formatEditableNutrition } from '@/lib/nutrition';

/* ============================================================
   Editar un registro.

   Al corregir algo ya anotado casi siempre se ajusta la hora o la
   porcion, no los macros uno por uno. Esos dos van arriba y los
   valores nutricionales quedan plegados: siguen disponibles, pero
   dejan de ocupar la hoja entera.
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
  const [showMacros, setShowMacros] = useState(false);

  const [calories, setCalories] = useState(formatEditableNutrition(food?.calories));
  const [protein, setProtein] = useState(formatEditableNutrition(food?.protein));
  const [carbs, setCarbs] = useState(formatEditableNutrition(food?.carbs));
  const [fat, setFat] = useState(formatEditableNutrition(food?.fat));
  const [fiber, setFiber] = useState(formatEditableNutrition(food?.fiber));

  if (!food) return null;

  const parseNutrition = (value: string) => Number(value.trim().replace(',', '.')) || 0;

  const save = () => {
    updateFood(targetDate, food.id, {
      time: time.trim() || food.time,
      portion: portion.trim() || food.portion,
      calories: parseNutrition(calories),
      protein: parseNutrition(protein),
      carbs: parseNutrition(carbs),
      fat: parseNutrition(fat),
      fiber: parseNutrition(fiber),
    });
    router.back();
  };

  const remove = () => {
    deleteFood(targetDate, food.id);
    router.back();
  };

  const macros = [
    { label: 'Calorías', value: calories, set: setCalories, unit: 'kcal' },
    { label: 'Proteína', value: protein, set: setProtein, unit: 'g' },
    { label: 'Carbohidratos', value: carbs, set: setCarbs, unit: 'g' },
    { label: 'Grasas', value: fat, set: setFat, unit: 'g' },
    { label: 'Fibra', value: fiber, set: setFiber, unit: 'g' },
  ];

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

        {/* Los macros rara vez se corrigen a mano: van plegados */}
        <View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: showMacros }}
            style={styles.disclosure}
            delayPressIn={0}
            onPress={() => setShowMacros((v) => !v)}>
            <Icon name={showMacros ? 'chevron-down' : 'chevron-right'} size={16} />
            <Text variant="bodyStrong" tone="secondary">
              Editar valores nutricionales
            </Text>
            <View style={styles.spacer} />
            <Text variant="number" tone="muted">
              {formatCalories(parseNutrition(calories))} kcal
            </Text>
          </TouchableOpacity>

          {showMacros ? (
            <View style={[styles.macros, { gap: theme.space.lg, marginTop: theme.space.lg }]}>
              {macros.map((m) => (
                <Field key={m.label} label={m.label} style={styles.macroField}>
                  <Input
                    variant="number"
                    value={m.value}
                    onChangeText={m.set}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </Field>
              ))}
            </View>
          ) : null}
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
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    paddingVertical: t.space.md,
    borderTopWidth: t.border.hairline,
    borderBottomWidth: t.border.hairline,
    borderColor: t.colors.border,
  },
  spacer: { flex: 1 },
  macros: { flexDirection: 'row', flexWrap: 'wrap' },
  macroField: { flexGrow: 1, flexBasis: '45%' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
}));
