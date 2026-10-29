import React, { useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { makeStyles } from '@/theme';
import { Button, Field, Input, Sheet, Text } from '@/components/ui';
import { CHILEAN_FOOD_SEALS, foodSealLabel } from '@/lib/chilean-food-seals';
import { parseFoodPortion } from '@/lib/food-portions';

/* Crear un alimento propio para la biblioteca. Usa las mismas
   primitivas que el resto de las hojas: antes traia sus propios
   inputs, etiquetas y boton, que no coincidian con ninguno. */

export default function CreateFoodScreen() {
  const styles = useStyles();
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
  const [error, setError] = useState('');

  const toggleSeal = (seal: string) =>
    setSeals((prev) => {
      const next = new Set(prev);
      if (next.has(seal)) next.delete(seal);
      else next.add(seal);
      return next;
    });

  const save = () => {
    if (!name.trim()) return;
    const parsedPortion = parseFoodPortion(portion);
    if (!parsedPortion) {
      setError('Usa una porción mayor que cero, por ejemplo 100g, 250ml o 1 unidad.');
      return;
    }

    const created = addCustomFood({
      name: name.trim(),
      portion: parsedPortion.normalized,
      calories: parseFloat(calories) || 0,
      protein: parseFloat(protein) || 0,
      carbs: parseFloat(carbs) || 0,
      fat: parseFloat(fat) || 0,
      fiber: parseFloat(fiber) || 0,
      typicalTime: '12:00',
      chileanSeals: Array.from(seals),
      category: 'Personalizados',
    });

    router.replace({ pathname: '/food-portion', params: { foodId: created.id } });
  };

  const macros = [
    { label: 'Calorías (kcal)', value: calories, set: setCalories },
    { label: 'Proteína (g)', value: protein, set: setProtein },
    { label: 'Carbohidratos (g)', value: carbs, set: setCarbs },
    { label: 'Grasas (g)', value: fat, set: setFat },
  ];

  return (
    <Sheet
      title="Crear alimento"
      subtitle="Los valores son por porción base"
      closeLabel="Cancelar"
      footer={<Button title="Guardar y ajustar porción" onPress={save} disabled={!name.trim()} />}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <Text tone="secondary">Tu alimento · ficha personal</Text>
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">Identidad y porción</Text>
        <FoodField label="Nombre">
          <Input
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Pan de masa madre"
            autoFocus
          />
        </FoodField>

        <FoodField label="Porción base" hint="La cantidad a la que corresponden los valores">
          <Input style={styles.input} value={portion} onChangeText={setPortion} placeholder="100g" />
        </FoodField>

        </View>
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">Información por {portion.trim() || 'porción'}</Text>
        <View style={styles.macros}>
          {macros.map((m) => (
            <FoodField key={m.label} label={m.label} style={styles.macroField}>
              <Input
                style={styles.input}
                variant="number"
                value={m.value}
                onChangeText={m.set}
                keyboardType="numeric"
                placeholder="0"
              />
            </FoodField>
          ))}
        </View>

        </View>
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">Opcionales</Text>
          <FoodField label="Fibra (g)">
            <Input style={styles.input} variant="number" value={fiber} onChangeText={setFiber} keyboardType="numeric" placeholder="0" />
          </FoodField>
        <FoodField label="Sellos" hint="Los que trae el envase, si corresponde">
          <View style={styles.seals}>
            {CHILEAN_FOOD_SEALS.map((seal) => {
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
                    {foodSealLabel(seal)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </FoodField>

        </View>

        {error ? (
          <Text accessibilityRole="alert" variant="body" tone="danger" selectable>
            {error}
          </Text>
        ) : null}

      </ScrollView>
    </Sheet>
  );
}

function FoodField({ label, hint, children, style, ...rest }: React.ComponentProps<typeof Field>) {
  const styles = useStyles();
  return (
    <View style={[styles.field, style]} {...rest}>
      <Text tone="secondary">{label}</Text>
      {React.Children.map(children, (child) =>
        React.isValidElement<React.ComponentProps<typeof Input>>(child) && child.type === Input
          ? React.cloneElement(child, { accessibilityLabel: child.props.accessibilityLabel ?? label })
          : child
      )}
      {hint ? <Text variant="caption" tone="secondary">{hint}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  scroll: { backgroundColor: t.colors.background },
  input: { minHeight: 48, borderRadius: 14 },
  field: { gap: t.space.sm },
  content: { padding: t.space.xl, paddingBottom: t.space.xxxl, gap: t.space.xl },
  group: { padding: t.space.xl, gap: t.space.lg, borderRadius: t.radius.xl, backgroundColor: t.colors.surface },
  macros: { flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space.lg, columnGap: '4%' },
  macroField: { width: '48%', minWidth: 0 },
  seals: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
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
