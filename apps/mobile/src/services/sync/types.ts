export const SYNC_COLLECTIONS = ['userPreferences', 'mealTemplates', 'mealLogs', 'weightLogs'] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sodiumMg?: number | null;
  cholesterolMg?: number | null;
}

export interface MealTemplateDetails {
  schemaVersion: 1;
  baseAmount: number;
  unit: MealUnit;
  nutrition: Nutrition;
  chileanSeals?: string[];
  category?: string | null;
  typicalTime?: string | null;
}

export interface MealTemplateDoc {
  id: string;
  name: string;
  isOfficial: boolean;
  details: MealTemplateDetails;
  updatedAt: number;
  _deleted: boolean;
}

export interface NutritionSnapshot extends MealTemplateDetails {}

export interface MealLogDoc {
  id: string;
  templateId: string | null;
  nameSnapshot: string;
  nutritionSnapshot: NutritionSnapshot;
  quantity: number;
  consumedAt: number;
  updatedAt: number;
  _deleted: boolean;
}

export interface UserPreferences {
  weightTrackingEnabled?: boolean;
}

export interface UserPreferencesDoc {
  id: string | number;
  preferences: UserPreferences;
  updatedAt: number;
  _deleted: boolean;
}

export interface WeightLogDoc {
  /** Chilean-local calendar date and stable per-day document id. */
  id: string;
  weightGrams: number;
  updatedAt: number;
  _deleted: boolean;
}

export type SyncDocument = UserPreferencesDoc | MealTemplateDoc | MealLogDoc | WeightLogDoc;

export interface SyncCheckpoint {
  updatedAt: number;
  id?: string;
}

export function isMealUnit(value: unknown): value is MealUnit {
  return value === 'g' || value === 'ml' || value === 'unit' || value === 'portion' || value === 'cup';
}

const nonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function isNutrition(value: unknown): value is Nutrition {
  if (!value || typeof value !== 'object') return false;
  const nutrition = value as Record<string, unknown>;
  return (
    nonNegative(nutrition.calories) &&
    nonNegative(nutrition.protein) &&
    nonNegative(nutrition.carbs) &&
    nonNegative(nutrition.fat) &&
    (nutrition.fiber === undefined || nutrition.fiber === null || nonNegative(nutrition.fiber)) &&
    (nutrition.sodiumMg === undefined || nutrition.sodiumMg === null || nonNegative(nutrition.sodiumMg)) &&
    (nutrition.cholesterolMg === undefined || nutrition.cholesterolMg === null || nonNegative(nutrition.cholesterolMg))
  );
}

export function isMealTemplateDetails(value: unknown): value is MealTemplateDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Record<string, unknown>;
  return (
    details.schemaVersion === 1 &&
    typeof details.baseAmount === 'number' &&
    Number.isFinite(details.baseAmount) &&
    details.baseAmount > 0 &&
    isMealUnit(details.unit) &&
    isNutrition(details.nutrition) &&
    (details.typicalTime === undefined || details.typicalTime === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(details.typicalTime)))
  );
}

export function isMealTemplateDoc(value: unknown): value is MealTemplateDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    typeof doc.name === 'string' &&
    typeof doc.isOfficial === 'boolean' &&
    typeof doc.updatedAt === 'number' &&
    typeof doc._deleted === 'boolean' &&
    isMealTemplateDetails(doc.details)
  );
}

export function isMealLogDoc(value: unknown): value is MealLogDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    (doc.templateId === null || typeof doc.templateId === 'string') &&
    typeof doc.nameSnapshot === 'string' &&
    isMealTemplateDetails(doc.nutritionSnapshot) &&
    typeof doc.quantity === 'number' &&
    Number.isFinite(doc.quantity) &&
    doc.quantity > 0 &&
    typeof doc.consumedAt === 'number' &&
    Number.isFinite(doc.consumedAt) &&
    typeof doc.updatedAt === 'number' &&
    typeof doc._deleted === 'boolean'
  );
}

export function isUserPreferencesDoc(value: unknown): value is UserPreferencesDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc.id !== 'string' && typeof doc.id !== 'number') return false;
  if (!doc.preferences || typeof doc.preferences !== 'object' || Array.isArray(doc.preferences))
    return false;
  const preferences = doc.preferences as Record<string, unknown>;
  return (
    (preferences.weightTrackingEnabled === undefined ||
      typeof preferences.weightTrackingEnabled === 'boolean') &&
    typeof doc.updatedAt === 'number' &&
    Number.isFinite(doc.updatedAt) &&
    typeof doc._deleted === 'boolean'
  );
}

export function isWeightLogDoc(value: unknown): value is WeightLogDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    isDateId(doc.id) &&
    typeof doc.weightGrams === 'number' &&
    Number.isInteger(doc.weightGrams) &&
    doc.weightGrams >= 1_000 &&
    doc.weightGrams <= 500_000 &&
    doc.weightGrams % 100 === 0 &&
    typeof doc.updatedAt === 'number' &&
    Number.isFinite(doc.updatedAt) &&
    typeof doc._deleted === 'boolean'
  );
}

export function isDateId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isSyncDocument(collection: SyncCollection, value: unknown): value is SyncDocument {
  if (collection === 'userPreferences') return isUserPreferencesDoc(value);
  if (collection === 'mealTemplates') return isMealTemplateDoc(value);
  if (collection === 'mealLogs') return isMealLogDoc(value);
  return isWeightLogDoc(value);
}

export function parseRejectedIndexes(value: unknown, rowCount: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const indexes = new Set<number>();
  for (const rejection of value) {
    const index =
      rejection && typeof rejection === 'object'
        ? (rejection as Record<string, unknown>).index
        : undefined;
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= rowCount) return null;
    indexes.add(Number(index));
  }
  return Array.from(indexes);
}
