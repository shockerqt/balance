import type { PortionRatio } from './types.ts';

export function canonicalQuantityForPortion(
  enteredQuantity: number,
  ratio?: PortionRatio | null,
): number | null {
  if (typeof enteredQuantity !== 'number' || !Number.isFinite(enteredQuantity) || enteredQuantity <= 0) {
    return null;
  }
  if (ratio === undefined || ratio === null) {
    return enteredQuantity;
  }
  if (typeof ratio !== 'object') {
    return null;
  }
  const { portionQuantity, canonicalQuantity } = ratio;
  if (
    typeof portionQuantity !== 'number' ||
    !Number.isFinite(portionQuantity) ||
    portionQuantity <= 0 ||
    typeof canonicalQuantity !== 'number' ||
    !Number.isFinite(canonicalQuantity) ||
    canonicalQuantity <= 0
  ) {
    return null;
  }
  const result = (enteredQuantity / portionQuantity) * canonicalQuantity;
  if (!Number.isFinite(result) || result <= 0) {
    return null;
  }
  return result;
}
