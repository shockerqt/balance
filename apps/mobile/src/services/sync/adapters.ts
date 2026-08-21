import type {
  CanonicalUnit,
  MealLogDoc,
  MealTemplateDetails,
  MealTemplateDoc,
  Nutrition,
  NutritionSnapshot,
} from './types';
import { parseFoodPortion } from '@/lib/food-portions';

export interface LibraryFoodAdapter {
  id: string; name: string; portion: string; calories: number; protein: number; carbs: number; fat: number;
  fiber?: number; sodiumMg?: number; cholesterolMg?: number; typicalTime: string; chileanSeals?: string[];
  category?: string; isOfficial?: boolean; updatedAt?: number;
}

export interface LoggedFoodAdapter {
  id: string; templateId?: string; name: string; portion: string; calories: number; protein: number; carbs: number; fat: number;
  fiber?: number; time: string; chileanSeals?: string[];
}

export const formatPortion = (amount: number, unit: CanonicalUnit) => `${amount}${unit}`;

export function templateToLibraryFood(doc: MealTemplateDoc, frequency = 0): LibraryFoodAdapter & { frequency: number } {
  const n = doc.details.nutritionPer100;
  return {
    id: doc.id, name: doc.name, portion: formatPortion(100, doc.details.canonicalUnit),
    calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat,
    fiber: n.fiber == null ? undefined : n.fiber, sodiumMg: n.sodiumMg == null ? undefined : n.sodiumMg,
    cholesterolMg: n.cholesterolMg == null ? undefined : n.cholesterolMg,
    typicalTime: doc.details.typicalTime == null ? '12:00' : doc.details.typicalTime, frequency,
    chileanSeals: doc.details.chileanSeals, category: doc.details.category == null ? undefined : doc.details.category,
    isOfficial: doc.isOfficial, updatedAt: doc.updatedAt,
  };
}

function scaleNutrition(n: Nutrition, factor: number) {
  return {
    calories: n.calories * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor,
    ...(n.fiber == null ? {} : { fiber: n.fiber * factor }),
    ...(n.sodiumMg == null ? {} : { sodiumMg: n.sodiumMg * factor }),
    ...(n.cholesterolMg == null ? {} : { cholesterolMg: n.cholesterolMg * factor }),
  };
}

function timeInChile(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(epochMs));
  } catch {
    const date = new Date(epochMs);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  }
}

export function logToLoggedFood(doc: MealLogDoc): LoggedFoodAdapter {
  const nutrition = scaleNutrition(doc.nutritionSnapshot.nutritionPer100, doc.canonicalQuantity / 100);
  const portion = doc.entry.portionSnapshot
    ? `${doc.entry.enteredQuantity} ${doc.entry.portionSnapshot.name}`
    : formatPortion(doc.canonicalQuantity, doc.nutritionSnapshot.canonicalUnit);
  return { id: doc.id, templateId: doc.templateId ?? undefined, name: doc.nameSnapshot, portion, ...nutrition, time: timeInChile(doc.consumedAt) };
}

function nutritionPer100(nutrition: Nutrition, amount: number): Nutrition {
  const factor = 100 / amount;
  const extendedNutrition = nutrition.extendedNutrition
    ? Object.fromEntries(Object.entries(nutrition.extendedNutrition).map(([key, value]) => [key, value == null ? value : value * factor]))
    : undefined;
  return {
    calories: Math.max(0, nutrition.calories) * factor, protein: Math.max(0, nutrition.protein) * factor,
    carbs: Math.max(0, nutrition.carbs) * factor, fat: Math.max(0, nutrition.fat) * factor,
    ...(nutrition.fiber == null ? {} : { fiber: Math.max(0, nutrition.fiber) * factor }),
    ...(nutrition.sodiumMg == null ? {} : { sodiumMg: Math.max(0, nutrition.sodiumMg) * factor }),
    ...(nutrition.cholesterolMg == null ? {} : { cholesterolMg: Math.max(0, nutrition.cholesterolMg) * factor }),
    ...(extendedNutrition ? { extendedNutrition } : {}),
  };
}

export function detailsFromLibraryFood(food: Omit<LibraryFoodAdapter, 'id'>): MealTemplateDetails {
  const portion = parseFoodPortion(food.portion);
  if (!portion) throw new Error('INVALID_FOOD_PORTION');
  const nutrition: Nutrition = { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat,
    ...(food.fiber === undefined ? {} : { fiber: food.fiber }), ...(food.sodiumMg === undefined ? {} : { sodiumMg: food.sodiumMg }),
    ...(food.cholesterolMg === undefined ? {} : { cholesterolMg: food.cholesterolMg }) };
  return { schemaVersion: 2, canonicalUnit: portion.unit, nutritionPer100: nutritionPer100(nutrition, portion.canonicalQuantity), portions: [],
    ...(food.chileanSeals?.length ? { chileanSeals: food.chileanSeals } : {}), ...(food.category ? { category: food.category } : {}),
    ...(food.typicalTime ? { typicalTime: food.typicalTime } : {}) };
}

export function snapshotFromDisplayFood(food: { calories: number; protein: number; carbs: number; fat: number; fiber?: number; portion: string }): NutritionSnapshot {
  const portion = parseFoodPortion(food.portion);
  if (!portion) throw new Error('INVALID_FOOD_PORTION');
  return { schemaVersion: 2, canonicalUnit: portion.unit, nutritionPer100: nutritionPer100({
    calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, ...(food.fiber === undefined ? {} : { fiber: food.fiber })
  }, portion.canonicalQuantity) };
}
