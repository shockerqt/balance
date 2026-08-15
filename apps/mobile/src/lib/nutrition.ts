export interface NutritionLike {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

const energyFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 0
});

const macroFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 1
});

const editableFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 6,
  useGrouping: false
});

const finiteOrZero = (value: number) => (Number.isFinite(value) ? value : 0);

/** Energy is presented as whole kilocalories. Internal values stay unchanged. */
export const formatCalories = (value: number) => energyFormatter.format(finiteOrZero(value));

/** Core macros are presented with at most one decimal gram and no trailing zero. */
export const formatMacroGrams = (value: number) => macroFormatter.format(finiteOrZero(value));

/** Editable fields expose useful precision without leaking binary-float artifacts. */
export const formatEditableNutrition = (value: number | undefined) => (value === undefined ? '' : editableFormatter.format(finiteOrZero(value)));

/** Aggregate raw values; rounding belongs at an output boundary, not in calculation. */
export function sumNutrition(values: NutritionLike[]): NutritionTotals {
  return values.reduce<NutritionTotals>(
    (total, value) => ({
      calories: total.calories + finiteOrZero(value.calories ?? 0),
      protein: total.protein + finiteOrZero(value.protein ?? 0),
      carbs: total.carbs + finiteOrZero(value.carbs ?? 0),
      fat: total.fat + finiteOrZero(value.fat ?? 0),
      fiber: total.fiber + finiteOrZero(value.fiber ?? 0)
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}
