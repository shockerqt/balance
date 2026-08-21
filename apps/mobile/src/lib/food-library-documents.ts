import type { MealTemplateDetails, MealTemplateDoc } from '../services/sync/types';

export class FoodLibraryMutationError extends Error {
  readonly code: 'invalid-name' | 'missing-food' | 'official-food';

  constructor(code: 'invalid-name' | 'missing-food' | 'official-food') {
    super(code);
    this.name = 'FoodLibraryMutationError';
    this.code = code;
  }
}

function normalizedName(name: string): string {
  const value = name.trim();
  if (!value || Array.from(value).length > 160) {
    throw new FoodLibraryMutationError('invalid-name');
  }
  return value;
}

function assertPersonal(doc: MealTemplateDoc | undefined): asserts doc is MealTemplateDoc {
  if (!doc || doc._deleted) throw new FoodLibraryMutationError('missing-food');
  if (doc.isOfficial) throw new FoodLibraryMutationError('official-food');
}

export function nextTemplateTimestamp(previousUpdatedAt: number, now = Date.now()): number {
  return Math.max(now, previousUpdatedAt + 1);
}

export function mergeEditedTemplateDetails(
  current: MealTemplateDetails,
  edited: MealTemplateDetails
): MealTemplateDetails {
  return {
    ...current,
    ...edited,
    nutritionPer100: { ...current.nutritionPer100, ...edited.nutritionPer100 },
    portions: current.canonicalUnit === edited.canonicalUnit
      ? current.portions.map((portion) => ({ ...portion }))
      : edited.portions,
  };
}

export function createPersonalTemplate(
  id: string,
  name: string,
  details: MealTemplateDetails,
  now = Date.now()
): MealTemplateDoc {
  return {
    id,
    name: normalizedName(name),
    isOfficial: false,
    details,
    updatedAt: Math.max(1, now),
    _deleted: false
  };
}

export function updatePersonalTemplate(
  current: MealTemplateDoc | undefined,
  name: string,
  details: MealTemplateDetails,
  now = Date.now()
): MealTemplateDoc {
  assertPersonal(current);
  return {
    ...current,
    name: normalizedName(name),
    details,
    updatedAt: nextTemplateTimestamp(current.updatedAt, now)
  };
}

export function deletePersonalTemplate(current: MealTemplateDoc | undefined, now = Date.now()): MealTemplateDoc {
  assertPersonal(current);
  return {
    ...current,
    updatedAt: nextTemplateTimestamp(current.updatedAt, now),
    _deleted: true
  };
}
