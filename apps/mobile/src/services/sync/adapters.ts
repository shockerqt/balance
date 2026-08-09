import {
  MealLogDoc,
  MealTemplateDetails,
  MealTemplateDoc,
  Nutrition,
  NutritionSnapshot,
  MealUnit,
} from './types';

export interface LibraryFoodAdapter {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodiumMg?: number;
  cholesterolMg?: number;
  typicalTime: string;
  chileanSeals?: string[];
  category?: string;
  isOfficial?: boolean;
  updatedAt?: number;
}

export interface LoggedFoodAdapter {
  id: string;
  templateId?: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  time: string;
  chileanSeals?: string[];
}

const unitLabel = (unit: MealUnit) => unit === 'unit' ? ' unidad' : unit;

export const formatPortion = (amount: number, unit: MealUnit) =>
  `${amount}${unitLabel(unit)}`;

export function templateToLibraryFood(doc: MealTemplateDoc, frequency = 0): LibraryFoodAdapter & { frequency: number } {
  const { details } = doc;
  return {
    id: doc.id,
    name: doc.name,
    portion: formatPortion(details.baseAmount, details.unit),
    calories: details.nutrition.calories,
    protein: details.nutrition.protein,
    carbs: details.nutrition.carbs,
    fat: details.nutrition.fat,
    fiber: details.nutrition.fiber == null ? undefined : details.nutrition.fiber,
    sodiumMg: details.nutrition.sodiumMg == null ? undefined : details.nutrition.sodiumMg,
    cholesterolMg: details.nutrition.cholesterolMg == null ? undefined : details.nutrition.cholesterolMg,
    typicalTime: details.typicalTime == null ? '12:00' : details.typicalTime,
    frequency,
    chileanSeals: details.chileanSeals,
    category: details.category == null ? undefined : details.category,
    isOfficial: doc.isOfficial,
    updatedAt: doc.updatedAt,
  };
}

interface DisplayNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodiumMg?: number;
  cholesterolMg?: number;
}

function nutritionForQuantity(snapshot: NutritionSnapshot, quantity: number): DisplayNutrition {
  const factor = quantity / snapshot.baseAmount;
  const n = snapshot.nutrition;
  return {
    calories: n.calories * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    ...(n.fiber == null ? {} : { fiber: n.fiber * factor }),
    ...(n.sodiumMg == null ? {} : { sodiumMg: n.sodiumMg * factor }),
    ...(n.cholesterolMg == null ? {} : { cholesterolMg: n.cholesterolMg * factor }),
  };
}

function timeInChile(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(epochMs));
  } catch {
    const date = new Date(epochMs);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  }
}

export function logToLoggedFood(doc: MealLogDoc): LoggedFoodAdapter {
  const nutrition = nutritionForQuantity(doc.nutritionSnapshot, doc.quantity);
  return {
    id: doc.id,
    templateId: doc.templateId ?? undefined,
    name: doc.nameSnapshot,
    portion: formatPortion(doc.quantity, doc.nutritionSnapshot.unit),
    ...nutrition,
    time: timeInChile(doc.consumedAt),
  };
}

export function detailsFromLibraryFood(food: Omit<LibraryFoodAdapter, 'id'>): MealTemplateDetails {
  const match = food.portion.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(g|ml|unit|unidad|portion|porción|cup|taza)$/i);
  const baseAmount = match ? Number(match[1]) : 100;
  const rawUnit = match?.[2].toLowerCase();
  const unit: MealUnit = rawUnit === 'unidad' ? 'unit' : rawUnit === 'porción' ? 'portion' : rawUnit === 'taza' ? 'cup' : (rawUnit as MealUnit) || 'g';
  return {
    schemaVersion: 1,
    baseAmount: baseAmount > 0 ? baseAmount : 100,
    unit,
    nutrition: {
      calories: Math.max(0, food.calories),
      protein: Math.max(0, food.protein),
      carbs: Math.max(0, food.carbs),
      fat: Math.max(0, food.fat),
      ...(food.fiber === undefined ? {} : { fiber: Math.max(0, food.fiber) }),
      ...(food.sodiumMg === undefined ? {} : { sodiumMg: Math.max(0, food.sodiumMg) }),
      ...(food.cholesterolMg === undefined ? {} : { cholesterolMg: Math.max(0, food.cholesterolMg) }),
    },
    ...(food.chileanSeals?.length ? { chileanSeals: food.chileanSeals } : {}),
    ...(food.category ? { category: food.category } : {}),
    ...(food.typicalTime ? { typicalTime: food.typicalTime } : {}),
  };
}

export function snapshotFromDisplayFood(food: {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  portion: string;
}): NutritionSnapshot {
  const match = food.portion.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(g|ml|unit|unidad|portion|porción|cup|taza)$/i);
  const baseAmount = match ? Number(match[1]) : 1;
  const rawUnit = match?.[2].toLowerCase();
  const unit: MealUnit = rawUnit === 'unidad' ? 'unit' : rawUnit === 'porción' ? 'portion' : rawUnit === 'taza' ? 'cup' : (rawUnit as MealUnit) || 'portion';
  return {
    schemaVersion: 1,
    baseAmount: baseAmount > 0 ? baseAmount : 1,
    unit,
    nutrition: {
      calories: Math.max(0, food.calories),
      protein: Math.max(0, food.protein),
      carbs: Math.max(0, food.carbs),
      fat: Math.max(0, food.fat),
      ...(food.fiber === undefined ? {} : { fiber: Math.max(0, food.fiber) }),
    },
  };
}
