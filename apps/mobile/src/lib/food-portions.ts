import type { CanonicalUnit } from '@/services/sync/types';

const PORTION_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\s*(g|ml)$/i;

export interface ParsedFoodPortion {
  canonicalQuantity: number;
  unit: CanonicalUnit;
  normalized: string;
}

export function parseFoodPortion(value: string): ParsedFoodPortion | null {
  const match = value.trim().match(PORTION_PATTERN);
  if (!match) return null;
  const canonicalQuantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(canonicalQuantity) || canonicalQuantity <= 0) return null;
  const unit = match[2].toLowerCase() as CanonicalUnit;
  return { canonicalQuantity, unit, normalized: `${canonicalQuantity}${unit}` };
}
