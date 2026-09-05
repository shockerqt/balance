import type { ExtendedNutrition, Nutrition } from './types.ts';

export function scaleNutrition(nutrition: Nutrition, factor: number): Nutrition {
  if (!nutrition || typeof nutrition !== 'object') {
    throw new TypeError('scaleNutrition: nutrition must be an object');
  }
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    throw new TypeError('scaleNutrition: factor must be a finite number');
  }

  const result: Nutrition = {
    calories: nutrition.calories * factor,
    protein: nutrition.protein * factor,
    carbs: nutrition.carbs * factor,
    fat: nutrition.fat * factor,
  };

  if (nutrition.fiber !== undefined) {
    result.fiber = nutrition.fiber === null ? null : nutrition.fiber * factor;
  }
  if (nutrition.sodiumMg !== undefined) {
    result.sodiumMg = nutrition.sodiumMg === null ? null : nutrition.sodiumMg * factor;
  }
  if (nutrition.cholesterolMg !== undefined) {
    result.cholesterolMg = nutrition.cholesterolMg === null ? null : nutrition.cholesterolMg * factor;
  }

  if (nutrition.extendedNutrition === null) {
    result.extendedNutrition = null;
  } else if (nutrition.extendedNutrition !== undefined) {
    const scaledExtended: ExtendedNutrition = {};
    for (const [key, value] of Object.entries(nutrition.extendedNutrition)) {
      if (value === null) {
        (scaledExtended as Record<string, number | null>)[key] = null;
      } else if (typeof value === 'number') {
        (scaledExtended as Record<string, number>)[key] = value * factor;
      }
    }
    result.extendedNutrition = scaledExtended;
  }

  return result;
}
