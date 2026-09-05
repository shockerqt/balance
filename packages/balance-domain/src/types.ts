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

export interface PortionRatio {
  portionQuantity: number;
  canonicalQuantity: number;
}
