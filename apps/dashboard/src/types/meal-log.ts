export type CanonicalUnit = 'g' | 'ml';

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sodiumMg?: number | null;
  cholesterolMg?: number | null;
  extendedNutrition?: Partial<Record<string, number>> | null;
}

export interface ImportProvenance {
  provider: 'macrofactor';
  externalId: string;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function nullableNonNegative(value: unknown): boolean {
  return value === undefined || value === null || nonNegative(value);
}

function isProvenance(value: unknown): value is ImportProvenance | null | undefined {
  if (value === undefined || value === null) return true;
  if (!isObject(value)) return false;
  return value.provider === 'macrofactor' && typeof value.externalId === 'string' && value.externalId.length > 0;
}

export function isCanonicalUnit(value: unknown): value is CanonicalUnit {
  return value === 'g' || value === 'ml';
}

export function isNutrition(value: unknown): value is Nutrition {
  if (!isObject(value)) return false;
  const extended = value.extendedNutrition;
  const extendedValid = extended === undefined || extended === null || (
    isObject(extended) && Object.values(extended).every(nonNegative)
  );
  return (
    nonNegative(value.calories) &&
    nonNegative(value.protein) &&
    nonNegative(value.carbs) &&
    nonNegative(value.fat) &&
    nullableNonNegative(value.fiber) &&
    nullableNonNegative(value.sodiumMg) &&
    nullableNonNegative(value.cholesterolMg) &&
    extendedValid
  );
}

function isPortionDefinition(value: unknown): value is PortionDefinition {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' && value.id.trim().length > 0 && value.id.length <= 80 &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120 &&
    positive(value.portionQuantity) &&
    positive(value.canonicalQuantity)
  );
}

function isPortionSnapshot(value: unknown): value is PortionSnapshot {
  if (!isObject(value)) return false;
  return (
    (value.portionId === undefined || (
      typeof value.portionId === 'string' && value.portionId.trim().length > 0 && value.portionId.length <= 80
    )) &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120 &&
    positive(value.portionQuantity) &&
    positive(value.canonicalQuantity)
  );
}

export function isMealTemplateDetails(value: unknown): value is MealTemplateDetails {
  if (!isObject(value)) return false;
  const portions = value.portions;
  if (
    value.schemaVersion !== 2 ||
    !isCanonicalUnit(value.canonicalUnit) ||
    !isNutrition(value.nutritionPer100) ||
    !Array.isArray(portions) ||
    !portions.every(isPortionDefinition)
  ) return false;
  const validPortions = portions as PortionDefinition[];
  const ids = new Set(validPortions.map((portion) => portion.id));
  return (
    ids.size === validPortions.length &&
    (value.chileanSeals === undefined || (
      Array.isArray(value.chileanSeals) && value.chileanSeals.every((seal) => typeof seal === 'string')
    )) &&
    (value.category === undefined || value.category === null || typeof value.category === 'string') &&
    (value.typicalTime === undefined || value.typicalTime === null || (
      typeof value.typicalTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.typicalTime)
    ))
  );
}

function isNutritionSnapshot(value: unknown): value is NutritionSnapshot {
  if (!isObject(value)) return false;
  return value.schemaVersion === 2 && isCanonicalUnit(value.canonicalUnit) && isNutrition(value.nutritionPer100);
}

function isMealLogEntry(value: unknown, canonicalQuantity: number): value is MealLogEntry {
  if (!isObject(value)) return false;
  const enteredQuantity = value.enteredQuantity;
  if (!positive(enteredQuantity)) return false;
  const portion = value.portionSnapshot;
  let expected = enteredQuantity;
  if (portion !== undefined && portion !== null) {
    if (!isPortionSnapshot(portion)) return false;
    expected = enteredQuantity / portion.portionQuantity * portion.canonicalQuantity;
  }
  const tolerance = Math.max(1e-8, Math.abs(expected) * 1e-8);
  return Math.abs(expected - canonicalQuantity) <= tolerance;
}

export function isMealTemplateDoc(value: unknown): value is MealTemplateDoc {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.isOfficial === 'boolean' &&
    isMealTemplateDetails(value.details) &&
    isProvenance(value.provenance) &&
    finite(value.updatedAt) &&
    typeof value._deleted === 'boolean'
  );
}

export function isMealLogDoc(value: unknown): value is MealLogDoc {
  if (!isObject(value)) return false;
  const canonicalQuantity = value.canonicalQuantity;
  if (!positive(canonicalQuantity)) return false;
  return (
    typeof value.id === 'string' &&
    (value.templateId === null || typeof value.templateId === 'string') &&
    typeof value.nameSnapshot === 'string' &&
    isNutritionSnapshot(value.nutritionSnapshot) &&
    isProvenance(value.provenance) &&
    isMealLogEntry(value.entry, canonicalQuantity) &&
    finite(value.consumedAt) &&
    finite(value.updatedAt) &&
    typeof value._deleted === 'boolean'
  );
}
