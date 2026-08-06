import React, { useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { makeStyles, useTheme } from '@/theme';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';

/* Crear un alimento propio para la biblioteca. Usa las mismas
   primitivas que el resto de las hojas: antes traia sus propios
   inputs, etiquetas y boton, que no coincidian con ninguno. */

const SELLOS = [
  'Alto en calorías',
  'Alto en sodio',
  'Alto en azúcares',
  'Alto en grasas saturadas',
];

export default function CreateFoodScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const { addCustomFood } = useFoodLibraryStore();

  const [name, setName] = useState('');
  const [portion, setPortion] = useState('100g');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [seals, setSeals] = useState<Set<string>>(new Set());

  const toggleSeal = (seal: string) =>
    setSeals((prev) => {
      const next = new Set(prev);
      if (next.has(seal)) next.delete(seal);
      else next.add(seal);
      return next;
    });

  const save = () => {
    if (!name.trim()) return;

    const created = addCustomFood({
      name: name.trim(),
      portion: portion.trim() || '100g',
      calories: parseFloat(calories) || 0,
      protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0,
      fat: parseFloat(fat) || 0,
      fiber: parseFloat(fiber) || 0,
      typicalTime: '12:00',
      chileanSeals: Array.from(seals).map((s) => s.toUpperCase()),
      category: 'Personalizados',
    });

    router.replace({ pathname: '/food-portion', params: { foodId: created.id } });
  };

  const macros = [
    { label: 'Calorías', value: calories, set: setCalories },
    { label: 'Proteína', value: protein, set: setProtein },
    { label: 'Carbohidratos', value: carbs, set: setCarbs },
    { label: 'Grasas', value: fat, set: setFat },
    { label: 'Fibra', value: fiber, set: setFiber },
  ];

  return (
    <Sheet
      title="Crear alimento"
      subtitle="Los valores son por porción base"
      closeLabel="Cancelar">
      <ScrollView
        contentContainerStyle={[styles.content, { gap: theme.space.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Field label="Nombre">
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Pan de masa madre"
            autoFocus
          />
        </Field>

        <Field label="Porción base" hint="La cantidad a la que corresponden los valores">
          <Input value={portion} onChangeText={setPortion} placeholder="100g" />
        </Field>

        <View style={[styles.macros, { gap: theme.space.lg }]}>
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

        <Field label="Sellos" hint="Los que trae el envase, si corresponde">
          <View style={[styles.seals, { gap: theme.space.sm }]}>
            {SELLOS.map((seal) => {
              const on = seals.has(seal);
              return (
                <TouchableOpacity
                  key={seal}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.seal, on && styles.sealOn]}
                  delayPressIn={0}
                  onPress={() => toggleSeal(seal)}>
                  <Text variant="caption" tone={on ? 'onPrimary' : 'secondary'}>
                    {seal}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>

        <Button title="Guardar y ajustar porción" onPress={save} disabled={!name.trim()} />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { padding: t.space.xl, paddingBottom: t.space.xxxl },
  macros: { flexDirection: 'row', flexWrap: 'wrap' },
  macroField: { flexGrow: 1, flexBasis: '45%' },
  seals: { flexDirection: 'row', flexWrap: 'wrap' },
  seal: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    borderRadius: t.radius.sm,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  sealOn: { backgroundColor: t.colors.danger, borderColor: t.colors.danger },
}));
