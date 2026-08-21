export const SYNC_COLLECTIONS = ['userPreferences', 'mealTemplates', 'mealLogs', 'weightLogs'] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export type CanonicalUnit = 'g' | 'ml';

export const EXTENDED_NUTRIENT_KEYS = [
  'alcoholG',
  'vitaminB12Mcg',
  'thiamineMg',
  'riboflavinMg',
  'niacinMg',
  'pantothenicAcidMg',
  'pyridoxineMg',
  'caffeineMg',
  'calciumMg',
  'cholineMg',
  'copperMg',
  'cysteineG',
  'monounsaturatedFatG',
  'polyunsaturatedFatG',
  'saturatedFatG',
  'transFatG',
  'folateMcg',
  'histidineG',
  'ironMg',
  'isoleucineG',
  'leucineG',
  'lysineG',
  'magnesiumMg',
  'manganeseMg',
  'methionineG',
  'omega3AlaG',
  'omega3DhaG',
  'omega3EpaG',
  'omega3G',
  'omega6G',
  'phenylalanineG',
  'phosphorusMg',
  'potassiumMg',
  'seleniumMcg',
  'starchG',
  'sugarsG',
  'addedSugarsG',
  'threonineG',
  'tryptophanG',
  'tyrosineG',
  'valineG',
  'vitaminAMcg',
  'vitaminCMg',
  'vitaminDMcg',
  'vitaminEMg',
  'vitaminKMcg',
  'waterG',
  'zincMg',
] as const;

export type ExtendedNutrientKey = (typeof EXTENDED_NUTRIENT_KEYS)[number];
export type ExtendedNutrition = Partial<Record<ExtendedNutrientKey, number>>;

export interface ImportProvenance {
  provider: 'macrofactor';
  externalId: string;
}

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sodiumMg?: number | null;
  cholesterolMg?: number | null;
  extendedNutrition?: ExtendedNutrition | null;
}

export interface PortionDefinition {
  id: string;
  name: string;
  portionQuantity: number;
  canonicalQuantity: number;
}

export interface MealTemplateDetails {
  schemaVersion: 2;
  canonicalUnit: CanonicalUnit;
  nutritionPer100: Nutrition;
  portions: PortionDefinition[];
  chileanSeals?: string[];
  category?: string | null;
  typicalTime?: string | null;
}

export interface MealTemplateDoc {
  id: string;
  name: string;
  isOfficial: boolean;
  details: MealTemplateDetails;
  provenance?: ImportProvenance | null;
  updatedAt: number;
  _deleted: boolean;
}

export interface NutritionSnapshot {
  schemaVersion: 2;
  canonicalUnit: CanonicalUnit;
  nutritionPer100: Nutrition;
}

export interface PortionSnapshot {
  portionId?: string;
  name: string;
  portionQuantity: number;
  canonicalQuantity: number;
}

export interface MealLogEntry {
  enteredQuantity: number;
  portionSnapshot?: PortionSnapshot | null;
}

export interface MealLogDoc {
  id: string;
  templateId: string | null;
  nameSnapshot: string;
  nutritionSnapshot: NutritionSnapshot;
  provenance?: ImportProvenance | null;
  canonicalQuantity: number;
  entry: MealLogEntry;
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

export interface SyncPushRejection {
  index: number;
  code: string;
  message: string;
}

export function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return value === 'g' || value === 'ml';
}

const nonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isExtendedNutrition(value: unknown): value is ExtendedNutrition {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set<string>(EXTENDED_NUTRIENT_KEYS);
  return Object.entries(value).every(([key, nutrient]) => allowed.has(key) && nonNegative(nutrient));
}

function isImportProvenance(value: unknown): value is ImportProvenance {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  return (
    provenance.provider === 'macrofactor' &&
    typeof provenance.externalId === 'string' &&
    provenance.externalId.length > 0 &&
    provenance.externalId.length <= 128
  );
}

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
    (nutrition.cholesterolMg === undefined ||
      nutrition.cholesterolMg === null ||
      nonNegative(nutrition.cholesterolMg)) &&
    isExtendedNutrition(nutrition.extendedNutrition)
  );
}

function isPortionDefinition(value: unknown): value is PortionDefinition {
  if (!value || typeof value !== 'object') return false;
  const portion = value as Record<string, unknown>;
  return (
    typeof portion.id === 'string' && portion.id.trim().length > 0 && portion.id.length <= 80 &&
    typeof portion.name === 'string' && portion.name.trim().length > 0 && portion.name.length <= 120 &&
    typeof portion.portionQuantity === 'number' && Number.isFinite(portion.portionQuantity) && portion.portionQuantity > 0 &&
    typeof portion.canonicalQuantity === 'number' && Number.isFinite(portion.canonicalQuantity) && portion.canonicalQuantity > 0
  );
}

export function isMealTemplateDetails(value: unknown): value is MealTemplateDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Record<string, unknown>;
  if (!Array.isArray(details.portions) || !details.portions.every(isPortionDefinition)) return false;
  const ids = new Set(details.portions.map((portion) => (portion as PortionDefinition).id));
  return (
    details.schemaVersion === 2 &&
    isCanonicalUnit(details.canonicalUnit) &&
    isNutrition(details.nutritionPer100) &&
    ids.size === details.portions.length &&
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
    isImportProvenance(doc.provenance) &&
    isMealTemplateDetails(doc.details)
  );
}

function isNutritionSnapshot(value: unknown): value is NutritionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.schemaVersion === 2 && isCanonicalUnit(snapshot.canonicalUnit) && isNutrition(snapshot.nutritionPer100);
}

function isMealLogEntry(value: unknown, canonicalQuantity: number): value is MealLogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.enteredQuantity !== 'number' || !Number.isFinite(entry.enteredQuantity) || entry.enteredQuantity <= 0) return false;
  let expected = entry.enteredQuantity;
  if (entry.portionSnapshot !== undefined && entry.portionSnapshot !== null) {
    if (!entry.portionSnapshot || typeof entry.portionSnapshot !== 'object') return false;
    const portion = entry.portionSnapshot as Record<string, unknown>;
    if (
      (portion.portionId !== undefined && (typeof portion.portionId !== 'string' || portion.portionId.length > 80)) ||
      typeof portion.name !== 'string' || !portion.name.trim() || portion.name.length > 120 ||
      typeof portion.portionQuantity !== 'number' || !Number.isFinite(portion.portionQuantity) || portion.portionQuantity <= 0 ||
      typeof portion.canonicalQuantity !== 'number' || !Number.isFinite(portion.canonicalQuantity) || portion.canonicalQuantity <= 0
    ) return false;
    expected = entry.enteredQuantity / portion.portionQuantity * portion.canonicalQuantity;
  }
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-8);
  return Math.abs(expected - canonicalQuantity) <= tolerance;
}

export function isMealLogDoc(value: unknown): value is MealLogDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    (doc.templateId === null || typeof doc.templateId === 'string') &&
    typeof doc.nameSnapshot === 'string' &&
    isNutritionSnapshot(doc.nutritionSnapshot) &&
    typeof doc.canonicalQuantity === 'number' &&
    Number.isFinite(doc.canonicalQuantity) &&
    doc.canonicalQuantity > 0 &&
    isMealLogEntry(doc.entry, doc.canonicalQuantity) &&
    typeof doc.consumedAt === 'number' && Number.isFinite(doc.consumedAt) &&
    typeof doc.updatedAt === 'number' &&
    typeof doc._deleted === 'boolean' &&
    isImportProvenance(doc.provenance)
  );
}

export function isUserPreferencesDoc(value: unknown): value is UserPreferencesDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc.id !== 'string' && typeof doc.id !== 'number') return false;
  if (!doc.preferences || typeof doc.preferences !== 'object' || Array.isArray(doc.preferences)) return false;
  const preferences = doc.preferences as Record<string, unknown>;
  return (
    (preferences.weightTrackingEnabled === undefined || typeof preferences.weightTrackingEnabled === 'boolean') &&
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
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isSyncDocument(collection: SyncCollection, value: unknown): value is SyncDocument {
  if (collection === 'userPreferences') return isUserPreferencesDoc(value);
  if (collection === 'mealTemplates') return isMealTemplateDoc(value);
  if (collection === 'mealLogs') return isMealLogDoc(value);
  return isWeightLogDoc(value);
}

export function parsePushRejections(value: unknown, rowCount: number): SyncPushRejection[] | null {
  if (!Array.isArray(value)) return null;
  const rejections = new Map<number, SyncPushRejection>();
  for (const rejection of value) {
    if (!rejection || typeof rejection !== 'object') return null;
    const row = rejection as Record<string, unknown>;
    if (
      !Number.isInteger(row.index) ||
      Number(row.index) < 0 ||
      Number(row.index) >= rowCount ||
      typeof row.code !== 'string' ||
      !row.code ||
      typeof row.message !== 'string' ||
      !row.message
    )
      return null;
    rejections.set(Number(row.index), {
      index: Number(row.index),
      code: row.code,
      message: row.message,
    });
  }
  return Array.from(rejections.values());
}
