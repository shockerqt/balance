import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LibraryFoodDraft, LibraryFoodItem, useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { Button, Field, Icon, Input, Sheet, Text } from '@/components/ui';
import { makeStyles } from '@/theme';

const SEALS = ['ALTO EN CALORÍAS', 'ALTO EN SODIO', 'ALTO EN AZÚCARES', 'ALTO EN GRASAS SATURADAS'];

const EMPTY_FORM = {
  name: '',
  portion: '100g',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sodiumMg: '',
  cholesterolMg: '',
  category: '',
  typicalTime: '12:00'
};

type FormState = typeof EMPTY_FORM;

const valueOf = (value: number | undefined) => (value === undefined ? '' : String(value));

function formFromFood(food?: LibraryFoodItem): FormState {
  if (!food) return EMPTY_FORM;
  return {
    name: food.name,
    portion: food.portion,
    calories: String(food.calories),
    protein: String(food.protein),
    carbs: String(food.carbs),
    fat: String(food.fat),
    fiber: valueOf(food.fiber),
    sodiumMg: valueOf(food.sodiumMg),
    cholesterolMg: valueOf(food.cholesterolMg),
    category: food.category ?? '',
    typicalTime: food.typicalTime
  };
}

const parseNumber = (value: string) => Number(value.trim().replace(',', '.'));

export default function FoodLibraryFoodScreen() {
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const foodId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { libraryFoods, isLibraryReady, addCustomFood, updateCustomFood, deleteCustomFood } = useFoodLibraryStore();
  const food = useMemo(
    () => (foodId ? libraryFoods.find((item) => item.id === foodId) : undefined),
    [foodId, libraryFoods]
  );
  const isCreating = !foodId;
  const isOfficial = food?.isOfficial === true;
  const isEditable = isCreating || (!!food && !isOfficial);

  const [form, setForm] = useState<FormState>(() => formFromFood(food));
  const [seals, setSeals] = useState<Set<string>>(
    () => new Set(food?.chileanSeals?.map((seal) => seal.toUpperCase()) ?? [])
  );
  const [error, setError] = useState('');
  const hydratedFoodId = useRef<string | undefined>(food?.id);

  useEffect(() => {
    if (!food || hydratedFoodId.current === food.id) return;
    hydratedFoodId.current = food.id;
    setForm(formFromFood(food));
    setSeals(new Set(food?.chileanSeals?.map((seal) => seal.toUpperCase()) ?? []));
    setError('');
  }, [food]);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (error) setError('');
  };

  const toggleSeal = (seal: string) => {
    if (!isEditable) return;
    setSeals((current) => {
      const next = new Set(current);
      if (next.has(seal)) next.delete(seal);
      else next.add(seal);
      return next;
    });
  };

  const buildDraft = (): LibraryFoodDraft | null => {
    const name = form.name.trim();
    if (!name) {
      setError('Escribe un nombre para guardar este alimento.');
      return null;
    }
    if (Array.from(name).length > 160) {
      setError('El nombre puede tener hasta 160 caracteres.');
      return null;
    }
    if (!/^([0-9]+(?:[.,][0-9]+)?)\s*(g|ml|unit|unidad|portion|porción|cup|taza)$/i.test(form.portion.trim())) {
      setError('Usa una porción compatible, por ejemplo 100g, 250ml, 1 unidad o 1 taza.');
      return null;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.typicalTime.trim())) {
      setError('La hora habitual debe usar el formato HH:mm, por ejemplo 08:30.');
      return null;
    }

    const required = [form.calories, form.protein, form.carbs, form.fat].map(parseNumber);
    const optional = [form.fiber, form.sodiumMg, form.cholesterolMg].map((value) =>
      value.trim() ? parseNumber(value) : undefined
    );
    if (
      [...required, ...optional.filter((value) => value !== undefined)].some(
        (value) => !Number.isFinite(value) || Number(value) < 0
      )
    ) {
      setError('Los valores nutricionales deben ser números iguales o mayores que cero.');
      return null;
    }

    return {
      name,
      portion: form.portion.trim(),
      calories: required[0],
      protein: required[1],
      carbs: required[2],
      fat: required[3],
      ...(optional[0] === undefined ? {} : { fiber: optional[0] }),
      ...(optional[1] === undefined ? {} : { sodiumMg: optional[1] }),
      ...(optional[2] === undefined ? {} : { cholesterolMg: optional[2] }),
      typicalTime: form.typicalTime.trim(),
      chileanSeals: Array.from(seals),
      ...(form.category.trim() ? { category: form.category.trim() } : {})
    };
  };

  const save = () => {
    const draft = buildDraft();
    if (!draft) return;
    try {
      if (food) updateCustomFood(food.id, draft);
      else addCustomFood(draft);
      router.back();
    } catch {
      setError('No se pudo guardar el alimento. Vuelve a abrir la ficha e inténtalo otra vez.');
    }
  };

  const confirmDelete = () => {
    if (!food || isOfficial) return;
    Alert.alert(
      'Eliminar alimento',
      `“${food.name}” dejará de aparecer en tu biblioteca. Tus registros anteriores conservarán sus datos.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            try {
              deleteCustomFood(food.id);
              router.back();
            } catch {
              setError('No se pudo eliminar el alimento. Vuelve a intentarlo.');
            }
          }
        }
      ]
    );
  };

  if (foodId && !food) {
    return (
      <Sheet title="Ficha de alimento">
        <View style={styles.missing}>
          <Icon name={isLibraryReady ? 'circle-alert' : 'loader-circle'} size={24} tone="muted" />
          <Text variant="heading">{isLibraryReady ? 'Este alimento ya no está disponible' : 'Abriendo ficha…'}</Text>
          {isLibraryReady ? (
            <Text variant="body" tone="secondary" style={styles.centered}>
              Puede haberse eliminado o pertenecer a otra cuenta.
            </Text>
          ) : null}
        </View>
      </Sheet>
    );
  }

  const macroFields: { key: keyof FormState; label: string; suffix: string }[] = [
    { key: 'calories', label: 'Calorías', suffix: 'kcal' },
    { key: 'protein', label: 'Proteína', suffix: 'g' },
    { key: 'carbs', label: 'Carbohidratos', suffix: 'g' },
    { key: 'fat', label: 'Grasas', suffix: 'g' },
    { key: 'fiber', label: 'Fibra', suffix: 'g' },
    { key: 'sodiumMg', label: 'Sodio', suffix: 'mg' },
    { key: 'cholesterolMg', label: 'Colesterol', suffix: 'mg' }
  ];

  const footer = isEditable ? (
    <View style={styles.footerActions}>
      <Button title={isCreating ? 'Crear alimento' : 'Guardar cambios'} onPress={save} />
      {!isCreating ? <Button title="Eliminar alimento" variant="ghost" size="md" onPress={confirmDelete} /> : null}
    </View>
  ) : undefined;

  return (
    <Sheet
      title={isCreating ? 'Nuevo alimento' : (food?.name ?? 'Alimento')}
      subtitle={isOfficial ? 'Ficha oficial · solo lectura' : 'Ficha personal · sincronización automática'}
      footer={footer}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.originNote}>
          <Icon name={isOfficial ? 'badge-check' : 'notebook-pen'} size={18} tone={isOfficial ? 'muted' : 'primary'} />
          <View style={styles.originCopy}>
            <Text variant="bodyStrong">{isOfficial ? 'Referencia oficial' : 'Tu alimento'}</Text>
            <Text variant="caption" tone="secondary">
              {isOfficial
                ? 'Puedes consultarlo y usarlo al registrar, pero no cambiar sus valores.'
                : 'Los cambios quedan disponibles sin conexión y se sincronizan al recuperar señal.'}
            </Text>
          </View>
        </View>

        <Field label="Nombre">
          <Input
            value={form.name}
            onChangeText={(value) => update('name', value)}
            placeholder="Pan de masa madre"
            editable={isEditable}
            autoFocus={isCreating}
          />
        </Field>

        <View style={styles.doubleRow}>
          <Field label="Porción base" hint="100g, 250ml, 1 unidad…" style={styles.halfField}>
            <Input
              value={form.portion}
              onChangeText={(value) => update('portion', value)}
              editable={isEditable}
              placeholder="100g"
            />
          </Field>
          <Field label="Hora habitual" hint="HH:mm" style={styles.halfField}>
            <Input
              value={form.typicalTime}
              onChangeText={(value) => update('typicalTime', value)}
              editable={isEditable}
              placeholder="12:00"
              keyboardType="numbers-and-punctuation"
            />
          </Field>
        </View>

        <Field label="Categoría" hint="Opcional; también sirve para buscar">
          <Input
            value={form.category}
            onChangeText={(value) => update('category', value)}
            editable={isEditable}
            placeholder="Desayuno, lácteos, receta…"
          />
        </Field>

        <View style={styles.ruleHeading}>
          <Text variant="label">VALORES POR {form.portion.trim().toUpperCase() || 'PORCIÓN'}</Text>
          <Text variant="caption" tone="muted">
            Cifras de la etiqueta o receta
          </Text>
        </View>

        <View style={styles.macros}>
          {macroFields.map((field) => (
            <Field key={field.key} label={field.label} style={styles.macroField}>
              <View style={styles.numberInput}>
                <Input
                  variant="number"
                  value={form[field.key]}
                  onChangeText={(value) => update(field.key, value)}
                  editable={isEditable}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  style={styles.numberControl}
                />
                <Text variant="caption" tone="muted" style={styles.unit}>
                  {field.suffix}
                </Text>
              </View>
            </Field>
          ))}
        </View>

        <Field label="Sellos chilenos" hint="Marca solo los que aparecen en el envase">
          <View style={styles.seals}>
            {SEALS.map((seal) => {
              const selected = seals.has(seal);
              return (
                <TouchableOpacity
                  key={seal}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: selected,
                    disabled: !isEditable
                  }}
                  disabled={!isEditable}
                  activeOpacity={0.75}
                  style={[styles.seal, selected && styles.sealSelected]}
                  onPress={() => toggleSeal(seal)}>
                  <Text variant="caption" tone={selected ? 'onPrimary' : 'secondary'}>
                    {seal}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>

        {error ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Icon name="circle-alert" size={18} tone="danger" />
            <Text variant="body" tone="danger" selectable style={styles.errorCopy}>
              {error}
            </Text>
          </View>
        ) : null}

        {!isEditable ? (
          <Text variant="caption" tone="muted" style={styles.officialFooter}>
            Última actualización del catálogo: los cambios oficiales llegan por sincronización.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    gap: t.space.xl,
    padding: t.space.xl,
    paddingBottom: t.space.xxxl
  },
  originNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.space.md,
    padding: t.space.lg,
    borderLeftWidth: t.border.ruleHeavy,
    borderColor: t.colors.text,
    backgroundColor: t.colors.surfaceRaised
  },
  originCopy: { flex: 1, gap: t.space.xs },
  doubleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.space.lg
  },
  halfField: { flex: 1 },
  ruleHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: t.space.md,
    paddingTop: t.space.sm,
    paddingBottom: t.space.sm,
    borderBottomWidth: t.border.rule,
    borderColor: t.colors.text
  },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.lg },
  macroField: { flexGrow: 1, flexBasis: '45%' },
  numberInput: { position: 'relative' },
  numberControl: { paddingRight: 42 },
  unit: { position: 'absolute', right: t.space.md, top: t.space.lg },
  seals: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  seal: {
    paddingHorizontal: t.space.md,
    paddingVertical: t.space.sm,
    borderWidth: t.border.hairline,
    borderColor: t.colors.border,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surfaceRaised
  },
  sealSelected: {
    borderColor: t.colors.danger,
    backgroundColor: t.colors.danger
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.space.sm,
    padding: t.space.md,
    borderWidth: t.border.hairline,
    borderColor: t.colors.danger,
    borderRadius: t.radius.sm
  },
  errorCopy: { flex: 1 },
  officialFooter: { textAlign: 'center', paddingTop: t.space.sm },
  footerActions: { gap: t.space.sm },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.space.md,
    padding: t.space.xxxl
  },
  centered: { textAlign: 'center' }
}));
