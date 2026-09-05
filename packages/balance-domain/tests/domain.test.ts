import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalQuantityForPortion,
  scaleNutrition,
  EXTENDED_NUTRIENT_KEYS,
  type MealTemplateDoc,
  type MealLogDoc,
  type Nutrition,
  type PortionDefinition,
} from '../src/index.ts';

// Numeric tolerance explicitly declared for floating point comparisons
const NUMERIC_TOLERANCE = 1e-9;

function assertNear(actual: number, expected: number, tolerance = NUMERIC_TOLERANCE, message?: string) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected} (diff: ${diff})`
  );
}

test('g/ml structural examples', () => {
  // Unit 'g' template and log structure
  const gramTemplate: MealTemplateDoc = {
    id: 'tpl-gram-1',
    name: 'Steamed Rice',
    isOfficial: false,
    updatedAt: 1700000000000,
    _deleted: false,
    details: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      portions: [
        { id: 'p-1', name: 'bowl', portionQuantity: 1, canonicalQuantity: 150 },
      ],
    },
  };
  assert.strictEqual(gramTemplate.details.canonicalUnit, 'g');

  const gramLog: MealLogDoc = {
    id: 'log-gram-1',
    templateId: gramTemplate.id,
    nameSnapshot: gramTemplate.name,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: gramTemplate.details.canonicalUnit,
      nutritionPer100: structuredClone(gramTemplate.details.nutritionPer100),
    },
    canonicalQuantity: 150,
    entry: {
      enteredQuantity: 1,
      portionSnapshot: { portionId: 'p-1', name: 'bowl', portionQuantity: 1, canonicalQuantity: 150 },
    },
    consumedAt: 1700000010000,
    updatedAt: 1700000010000,
    _deleted: false,
  };
  assert.strictEqual(gramLog.nutritionSnapshot.canonicalUnit, 'g');

  // Direct canonical quantity without ratio
  assert.strictEqual(canonicalQuantityForPortion(150), 150);
  assert.strictEqual(canonicalQuantityForPortion(150, null), 150);

  // Unit 'ml' template and log structure
  const mlTemplate: MealTemplateDoc = {
    id: 'tpl-ml-1',
    name: 'Whole Milk',
    isOfficial: false,
    updatedAt: 1700000000000,
    _deleted: false,
    details: {
      schemaVersion: 2,
      canonicalUnit: 'ml',
      nutritionPer100: { calories: 62, protein: 3.2, carbs: 4.8, fat: 3.3 },
      portions: [
        { id: 'p-2', name: 'glass', portionQuantity: 1, canonicalQuantity: 250 },
      ],
    },
  };
  assert.strictEqual(mlTemplate.details.canonicalUnit, 'ml');

  const mlLog: MealLogDoc = {
    id: 'log-ml-1',
    templateId: mlTemplate.id,
    nameSnapshot: mlTemplate.name,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: mlTemplate.details.canonicalUnit,
      nutritionPer100: structuredClone(mlTemplate.details.nutritionPer100),
    },
    canonicalQuantity: 250,
    entry: { enteredQuantity: 250 },
    consumedAt: 1700000020000,
    updatedAt: 1700000020000,
    _deleted: false,
  };
  assert.strictEqual(mlLog.nutritionSnapshot.canonicalUnit, 'ml');
  assert.strictEqual(canonicalQuantityForPortion(250), 250);
});

test('5 spoons=30g and 1=6g with evaluation order', () => {
  // 1 spoon = 6g definition
  const oneSpoonIsSixG = { portionQuantity: 1, canonicalQuantity: 6 };
  assert.strictEqual(canonicalQuantityForPortion(5, oneSpoonIsSixG), 30);
  assert.strictEqual(canonicalQuantityForPortion(1, oneSpoonIsSixG), 6);

  // 5 spoons = 30g definition
  const fiveSpoonsAreThirtyG = { portionQuantity: 5, canonicalQuantity: 30 };
  assert.strictEqual(canonicalQuantityForPortion(1, fiveSpoonsAreThirtyG), 6);
  assert.strictEqual(canonicalQuantityForPortion(5, fiveSpoonsAreThirtyG), 30);
  assert.strictEqual(canonicalQuantityForPortion(2.5, fiveSpoonsAreThirtyG), 15);

  // Evaluation order entered / portionQuantity * canonicalQuantity
  const entered = 10;
  const portionQuantity = 3;
  const canonicalQuantity = 3;
  const expected = (entered / portionQuantity) * canonicalQuantity;
  assert.strictEqual(canonicalQuantityForPortion(entered, { portionQuantity, canonicalQuantity }), expected);
});

test('fractional per100 scaling', () => {
  const oats: Nutrition = {
    calories: 389,
    protein: 16.9,
    carbs: 66.3,
    fat: 6.9,
  };

  // 45g consumed -> factor 0.45
  const scaled45 = scaleNutrition(oats, 0.45);
  assertNear(scaled45.calories, 389 * 0.45);
  assertNear(scaled45.protein, 16.9 * 0.45);
  assertNear(scaled45.carbs, 66.3 * 0.45);
  assertNear(scaled45.fat, 6.9 * 0.45);

  // 33.3g consumed -> factor 0.333
  const scaled33 = scaleNutrition(oats, 0.333);
  assertNear(scaled33.calories, 389 * 0.333);
  assertNear(scaled33.protein, 16.9 * 0.333);
  assertNear(scaled33.carbs, 66.3 * 0.333);
  assertNear(scaled33.fat, 6.9 * 0.333);
});

test('historical snapshot independent from changed template', () => {
  const originalPortion: PortionDefinition = { id: 'p-cup', name: 'cup', portionQuantity: 1, canonicalQuantity: 150 };
  const template: MealTemplateDoc = {
    id: 'tpl-yogurt',
    name: 'Original Greek Yogurt',
    isOfficial: false,
    updatedAt: 1000,
    _deleted: false,
    details: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 120, protein: 10, carbs: 4, fat: 5 },
      portions: [structuredClone(originalPortion)],
    },
  };

  // Create meal log capturing snapshots
  const log: MealLogDoc = {
    id: 'log-yogurt-1',
    templateId: template.id,
    nameSnapshot: template.name,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: template.details.canonicalUnit,
      nutritionPer100: structuredClone(template.details.nutritionPer100),
    },
    canonicalQuantity: canonicalQuantityForPortion(2, template.details.portions[0])!,
    entry: {
      enteredQuantity: 2,
      portionSnapshot: { portionId: originalPortion.id, name: originalPortion.name, portionQuantity: originalPortion.portionQuantity, canonicalQuantity: originalPortion.canonicalQuantity },
    },
    consumedAt: 2000,
    updatedAt: 2000,
    _deleted: false,
  };

  assert.strictEqual(log.canonicalQuantity, 300);
  const initialLogNutrition = scaleNutrition(log.nutritionSnapshot.nutritionPer100, log.canonicalQuantity / 100);
  assertNear(initialLogNutrition.calories, 360);

  // Mutate template (e.g. manufacturer changes recipe and portion sizes)
  template.name = 'Reformulated Zero-Fat Yogurt';
  template.details.nutritionPer100.calories = 60;
  template.details.nutritionPer100.protein = 15;
  template.details.portions[0].canonicalQuantity = 100;

  // Meal log historical snapshot remains unchanged
  assert.strictEqual(log.nameSnapshot, 'Original Greek Yogurt');
  assert.strictEqual(log.nutritionSnapshot.nutritionPer100.calories, 120);
  assert.strictEqual(log.entry.portionSnapshot?.canonicalQuantity, 150);
  assert.strictEqual(log.canonicalQuantity, 300);

  // Nutrition calculated from historical snapshot is unchanged
  const postMutationNutrition = scaleNutrition(log.nutritionSnapshot.nutritionPer100, log.canonicalQuantity / 100);
  assertNear(postMutationNutrition.calories, 360);
  assertNear(postMutationNutrition.protein, 30);
});

test('invalid numeric inputs', () => {
  // canonicalQuantityForPortion invalid enteredQuantity
  assert.strictEqual(canonicalQuantityForPortion(0), null);
  assert.strictEqual(canonicalQuantityForPortion(-1), null);
  assert.strictEqual(canonicalQuantityForPortion(-0.001), null);
  assert.strictEqual(canonicalQuantityForPortion(NaN), null);
  assert.strictEqual(canonicalQuantityForPortion(Infinity), null);
  assert.strictEqual(canonicalQuantityForPortion(-Infinity), null);
  assert.strictEqual(canonicalQuantityForPortion('100' as unknown as number), null);
  assert.strictEqual(canonicalQuantityForPortion(null as unknown as number), null);
  assert.strictEqual(canonicalQuantityForPortion(undefined as unknown as number), null);

  // canonicalQuantityForPortion invalid ratio properties
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: 0, canonicalQuantity: 10 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: -1, canonicalQuantity: 10 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: NaN, canonicalQuantity: 10 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: Infinity, canonicalQuantity: 10 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: 1, canonicalQuantity: 0 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: 1, canonicalQuantity: -10 }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: 1, canonicalQuantity: NaN }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, { portionQuantity: 1, canonicalQuantity: Infinity }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, {} as unknown as { portionQuantity: number; canonicalQuantity: number }), null);
  assert.strictEqual(canonicalQuantityForPortion(5, 'invalid' as unknown as { portionQuantity: number; canonicalQuantity: number }), null);

  // scaleNutrition invalid inputs
  const sample: Nutrition = { calories: 100, protein: 10, carbs: 10, fat: 5 };
  assert.throws(() => scaleNutrition(sample, NaN), TypeError);
  assert.throws(() => scaleNutrition(sample, Infinity), TypeError);
  assert.throws(() => scaleNutrition(sample, -Infinity), TypeError);
  assert.throws(() => scaleNutrition(sample, -0.5), TypeError);
  assert.deepStrictEqual(scaleNutrition(sample, 0), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.throws(() => scaleNutrition(sample, '2' as unknown as number), TypeError);
  assert.throws(() => scaleNutrition(null as unknown as Nutrition, 1), TypeError);
  assert.throws(() => scaleNutrition(undefined as unknown as Nutrition, 1), TypeError);
});

test('optional absent, null, zero, and extended nutrients', () => {
  const base: Nutrition = { calories: 200, protein: 10, carbs: 20, fat: 5 };

  // Absent optional fields remain absent
  const scaledAbsent = scaleNutrition(base, 1.5);
  assert.strictEqual(scaledAbsent.calories, 300);
  assert.strictEqual(scaledAbsent.fiber, undefined);
  assert.strictEqual('fiber' in scaledAbsent, false);
  assert.strictEqual(scaledAbsent.sodiumMg, undefined);
  assert.strictEqual('sodiumMg' in scaledAbsent, false);
  assert.strictEqual(scaledAbsent.cholesterolMg, undefined);
  assert.strictEqual('cholesterolMg' in scaledAbsent, false);
  assert.strictEqual(scaledAbsent.extendedNutrition, undefined);
  assert.strictEqual('extendedNutrition' in scaledAbsent, false);

  // Null optional fields preserved as null
  const withNulls: Nutrition = {
    ...base,
    fiber: null,
    sodiumMg: null,
    cholesterolMg: null,
    extendedNutrition: null,
  };
  const scaledNulls = scaleNutrition(withNulls, 2);
  assert.strictEqual(scaledNulls.fiber, null);
  assert.strictEqual(scaledNulls.sodiumMg, null);
  assert.strictEqual(scaledNulls.cholesterolMg, null);
  assert.strictEqual(scaledNulls.extendedNutrition, null);

  // Zero optional fields preserved as zero
  const withZeros: Nutrition = {
    ...base,
    fiber: 0,
    sodiumMg: 0,
    cholesterolMg: 0,
    extendedNutrition: { ironMg: 0, caffeineMg: 0 },
  };
  const scaledZeros = scaleNutrition(withZeros, 2);
  assert.strictEqual(scaledZeros.fiber, 0);
  assert.strictEqual(scaledZeros.sodiumMg, 0);
  assert.strictEqual(scaledZeros.cholesterolMg, 0);
  assert.strictEqual(scaledZeros.extendedNutrition?.ironMg, 0);
  assert.strictEqual(scaledZeros.extendedNutrition?.caffeineMg, 0);

  // Extended nutrients scaled without rounding
  const withExtended: Nutrition = {
    ...base,
    fiber: 3.333333333333333,
    extendedNutrition: {
      ironMg: 14.123456789,
      calciumMg: 200.5,
      vitaminCMg: 60.123456789,
    },
  };
  const factor = 1.3333333333333333;
  const scaledExtended = scaleNutrition(withExtended, factor);
  assertNear(scaledExtended.fiber!, 3.333333333333333 * factor);
  // Preserves exact floating point multiplication with no rounding
  assert.strictEqual(scaledExtended.extendedNutrition?.ironMg, 14.123456789 * factor);
  assert.strictEqual(scaledExtended.extendedNutrition?.calciumMg, 200.5 * factor);
  assert.strictEqual(scaledExtended.extendedNutrition?.vitaminCMg, 60.123456789 * factor);

  // Verify EXTENDED_NUTRIENT_KEYS contains the expected keys
  assert.ok(EXTENDED_NUTRIENT_KEYS.includes('ironMg'));
  assert.ok(EXTENDED_NUTRIENT_KEYS.includes('calciumMg'));
  assert.ok(EXTENDED_NUTRIENT_KEYS.includes('vitaminCMg'));
});
