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
