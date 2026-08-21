import type { CanonicalUnit, MealLogDoc, MealLogEntry } from '@/services/sync/types';

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

export interface ResolvedMealLogPortion {
  canonicalQuantity: number;
  entry: MealLogEntry;
}

const NAMED_PORTION_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\s+(.+)$/;

export function resolveMealLogPortion(doc: MealLogDoc, value: string): ResolvedMealLogPortion | null {
  const canonical = parseFoodPortion(value);
  if (canonical) {
    if (canonical.unit !== doc.nutritionSnapshot.canonicalUnit) return null;
    return {
      canonicalQuantity: canonical.canonicalQuantity,
      entry: { enteredQuantity: canonical.canonicalQuantity },
    };
  }

  const snapshot = doc.entry.portionSnapshot;
  if (!snapshot) return null;
  const match = value.trim().match(NAMED_PORTION_PATTERN);
  if (!match) return null;
  const enteredQuantity = Number(match[1].replace(',', '.'));
  const name = match[2].trim();
  if (!Number.isFinite(enteredQuantity) || enteredQuantity <= 0) return null;
  if (name.localeCompare(snapshot.name, undefined, { sensitivity: 'accent' }) !== 0) return null;

  const portionSnapshot = { ...snapshot };
  return {
    canonicalQuantity: enteredQuantity / portionSnapshot.portionQuantity * portionSnapshot.canonicalQuantity,
    entry: { enteredQuantity, portionSnapshot },
  };
}

/**
 * Meal-log name and nutrition are historical snapshots. Existing logs only
 * support changing their quantity and consumption time across sync clients.
 */
export function updateMealLogQuantityAndTime(
  doc: MealLogDoc,
  portion: string,
  consumedAt: number,
  updatedAt: number
): MealLogDoc | null {
  const resolvedPortion = resolveMealLogPortion(doc, portion);
  if (!resolvedPortion) return null;

  return {
    ...doc,
    canonicalQuantity: resolvedPortion.canonicalQuantity,
    entry: resolvedPortion.entry,
    consumedAt,
    updatedAt,
  };
}
