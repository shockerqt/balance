import type { MealUnit } from '@/services/sync/types';

const PORTION_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\s*(g|ml|unit|unidad|portion|porción|cup|taza)$/i;

export interface ParsedFoodPortion {
  baseAmount: number;
  unit: MealUnit;
  normalized: string;
}

const canonicalUnit = (value: string): MealUnit => {
  const unit = value.toLocaleLowerCase('es-CL');
  if (unit === 'unidad') return 'unit';
  if (unit === 'porción') return 'portion';
  if (unit === 'taza') return 'cup';
  return unit as MealUnit;
};

export function parseFoodPortion(value: string): ParsedFoodPortion | null {
  const match = value.trim().match(PORTION_PATTERN);
  if (!match) return null;
  const baseAmount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return null;
  const unit = canonicalUnit(match[2]);
  return { baseAmount, unit, normalized: `${baseAmount}${unit}` };
}
