import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useMealStore } from '@/hooks/use-meal-store';
import { parsePortion, scaleMacros } from '@/lib/portion';
import { MacroSummary } from '@/components/food-search/macro-summary';
import { Button, Sheet, Text } from '@/components/ui';
import { makeStyles, useTheme } from '@/theme';

/* Ajuste de porcion. El escalado vive en lib/portion (probable por
   separado) y el cuadro de macros es un componente. */

export default function FoodPortionScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ foodId?: string; dateId?: string; time?: string }>();

  const { libraryFoods, incrementFoodFrequency } = useFoodLibraryStore();
  const { addFood, selectedDateId } = useMealStore();

  const targetDateId = params.dateId || selectedDateId;
  const targetTime = params.time || '08:30';

  const food = useMemo(
    () => libraryFoods.find((f) => f.id === params.foodId) ?? libraryFoods[0],
    [libraryFoods, params.foodId]
  );

  const [quantity, setQuantity] = useState('100');
  const [unit, setUnit] = useState('g');
  const [time, setTime] = useState(targetTime);

  useEffect(() => {
    if (!food) return;
    const base = parsePortion(food.portion);
    setQuantity(String(base.quantity));
    setUnit(base.unit);
    setTime(targetTime);
  }, [food, targetTime]);

  const macros = useMemo(
    () => (food ? scaleMacros(food, parseFloat(quantity) || 0) : null),
    [food, quantity]
  );

  if (!food || !macros) return null;

  const confirm = () => {
    incrementFoodFrequency(food.id);
    addFood(targetDateId, {
      name: food.name,
      portion: `${quantity}${unit}`,
      ...macros,
      time: time.trim() || targetTime,
    });
    router.dismissAll();
  };

  return (
    <Sheet title="Ajustar porción" subtitle={food.name} closeLabel="Cancelar">
      <ScrollView
        contentContainerStyle={{ padding: theme.space.xl, gap: theme.space.xl }}
        showsVerticalScrollIndicator={false}>
        {food.chileanSeals?.length ? (
          <View style={styles.seals}>
            {food.chileanSeals.map((seal) => (
              <View key={seal} style={styles.seal}>
                <Text variant="label" tone="onPrimary">
                  {seal}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.field}>
          <Text variant="label" tone="muted">
            CANTIDAD Y PORCIÓN
          </Text>
          <View style={styles.qtyRow}>
            <TextInput
              style={styles.qtyInput}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="numeric"
              autoFocus
              selectTextOnFocus
              placeholder="100"
              placeholderTextColor={theme.colors.textMuted}
            />
            <Text variant="heading" tone="secondary">
              {unit}
            </Text>
          </View>
        </View>

        <MacroSummary macros={macros} />

        <View style={styles.field}>
          <Text variant="label" tone="muted">
            HORA DE CONSUMO
          </Text>
          <TextInput
            style={styles.timeInput}
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
        </View>

        <Button title={`Agregar a las ${time}`} onPress={confirm} />
      </ScrollView>
    </Sheet>
  );
};

const useStyles = makeStyles((t) => ({
  seals: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  seal: {
    paddingHorizontal: t.space.sm,
    paddingVertical: t.space.xs,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.danger,
  },
  field: { gap: t.space.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  qtyInput: {
    flex: 1,
    color: t.colors.text,
    fontSize: 32,
    fontWeight: '800',
    paddingVertical: t.space.md,
    paddingHorizontal: t.space.lg,
    borderRadius: t.radius.md,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  timeInput: {
    color: t.colors.text,
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: t.space.md,
    paddingHorizontal: t.space.lg,
    borderRadius: t.radius.md,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
}));
