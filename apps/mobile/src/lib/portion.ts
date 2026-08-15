import type { LibraryFoodItem } from '@/hooks/use-food-library-store';

/* Escalado de porciones. Conserva la precision de calculo; la UI
   aplica su politica de presentacion al renderizar. */

export interface ParsedPortion {
  quantity: number;
  unit: string;
}

const PORTION_RE = /^(\d+(?:[.,]\d+)?)\s*(.*)$/;
const DEFAULT_PORTION: ParsedPortion = { quantity: 100, unit: 'g' };

/** "150 g" -> { quantity: 150, unit: 'g' }. Cae a 100 g si no calza. */
export function parsePortion(portion: string): ParsedPortion {
  const match = portion?.trim().match(PORTION_RE);
  if (!match?.[1]) return DEFAULT_PORTION;

  const quantity = parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity <= 0) return DEFAULT_PORTION;

  return { quantity, unit: match[2]?.trim() || DEFAULT_PORTION.unit };
}

export interface ScaledMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/**
 * Reescala los macros de un alimento a la cantidad pedida, tomando su
 * porcion base como referencia.
 */
export function scaleMacros(food: LibraryFoodItem, quantity: number): ScaledMacros {
  const base = parsePortion(food.portion).quantity;
  const factor = base > 0 && Number.isFinite(quantity) ? quantity / base : 1;

  return {
    calories: food.calories * factor,
    protein: food.protein * factor,
    carbs: food.carbs * factor,
    fat: food.fat * factor,
    fiber: (food.fiber ?? 0) * factor,
  };
}
