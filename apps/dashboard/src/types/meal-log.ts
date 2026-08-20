export type MealUnit = 'g' | 'ml' | 'unit' | 'portion' | 'cup';

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

export interface MealTemplateDetails {
  schemaVersion: 1;
  baseAmount: number;
  unit: MealUnit;
  servingLabel?: string | null;
  gramsPerUnit?: number | null;
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
  provenance?: ImportProvenance | null;
  updatedAt: number;
  _deleted: boolean;
}

export interface MealLogDoc {
  id: string;
  templateId: string | null;
  nameSnapshot: string;
  nutritionSnapshot: MealTemplateDetails;
  provenance?: ImportProvenance | null;
  quantity: number;
  consumedAt: number;
  updatedAt: number;
  _deleted: boolean;
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegative(value: unknown): boolean {
  return value === undefined || value === null || nonNegative(value);
}

function isProvenance(value: unknown): value is ImportProvenance | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  return provenance.provider === 'macrofactor' && typeof provenance.externalId === 'string' && provenance.externalId.length > 0;
}

export function isMealUnit(value: unknown): value is MealUnit {
  return value === 'g' || value === 'ml' || value === 'unit' || value === 'portion' || value === 'cup';
}

export function isNutrition(value: unknown): value is Nutrition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const nutrition = value as Record<string, unknown>;
  const extended = nutrition.extendedNutrition;
  const extendedValid = extended === undefined || extended === null || (
    typeof extended === 'object' &&
    !Array.isArray(extended) &&
    Object.values(extended as Record<string, unknown>).every(nonNegative)
  );
  return (
    nonNegative(nutrition.calories) &&
    nonNegative(nutrition.protein) &&
    nonNegative(nutrition.carbs) &&
    nonNegative(nutrition.fat) &&
    isNullableNonNegative(nutrition.fiber) &&
    isNullableNonNegative(nutrition.sodiumMg) &&
    isNullableNonNegative(nutrition.cholesterolMg) &&
    extendedValid
  );
}

export function isMealTemplateDetails(value: unknown): value is MealTemplateDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const details = value as Record<string, unknown>;
  return (
    details.schemaVersion === 1 &&
    typeof details.baseAmount === 'number' && Number.isFinite(details.baseAmount) && details.baseAmount > 0 &&
    isMealUnit(details.unit) &&
    (details.servingLabel === undefined || details.servingLabel === null || typeof details.servingLabel === 'string') &&
    (details.gramsPerUnit === undefined || details.gramsPerUnit === null || (
      typeof details.gramsPerUnit === 'number' && Number.isFinite(details.gramsPerUnit) && details.gramsPerUnit > 0
    )) &&
    (details.typicalTime === undefined || details.typicalTime === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(details.typicalTime))) &&
    isNutrition(details.nutrition)
  );
}

export function isMealTemplateDoc(value: unknown): value is MealTemplateDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === 'string' &&
    typeof document.name === 'string' &&
    typeof document.isOfficial === 'boolean' &&
    isMealTemplateDetails(document.details) &&
    isProvenance(document.provenance) &&
    typeof document.updatedAt === 'number' && Number.isFinite(document.updatedAt) &&
    typeof document._deleted === 'boolean'
  );
}

export function isMealLogDoc(value: unknown): value is MealLogDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === 'string' &&
    (document.templateId === null || typeof document.templateId === 'string') &&
    typeof document.nameSnapshot === 'string' &&
    isMealTemplateDetails(document.nutritionSnapshot) &&
    isProvenance(document.provenance) &&
    typeof document.quantity === 'number' && Number.isFinite(document.quantity) && document.quantity > 0 &&
    typeof document.consumedAt === 'number' && Number.isFinite(document.consumedAt) &&
    typeof document.updatedAt === 'number' && Number.isFinite(document.updatedAt) &&
    typeof document._deleted === 'boolean'
  );
}
