import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveMealLogPortion,
  updateMealLogQuantityAndTime,
} from '../src/lib/food-portions.ts';
import { logToLoggedFood } from '../src/services/sync/adapters.ts';

const baseNutritionPer100 = {
  calories: 200,
  protein: 10,
  carbs: 30,
  fat: 5,
  fiber: 4,
  sodiumMg: 100,
  cholesterolMg: 10,
};

function createSyntheticV2Doc(overrides = {}) {
  return {
    id: 'log-v2-synthetic',
    templateId: 'tmpl-v2-1',
    nameSnapshot: 'Avena con leche',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { ...baseNutritionPer100 },
    },
    canonicalQuantity: 30,
    entry: {
      enteredQuantity: 5,
      portionSnapshot: {
        portionId: 'portion-cucharada',
        name: 'cucharadas',
        portionQuantity: 5,
        canonicalQuantity: 30,
      },
    },
    consumedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    _deleted: false,
    ...overrides,
  };
}

test('synthetic V2 doc 5 cucharadas=30g edits to 1 => 6g and preserves identity/tombstone/snapshot/time', () => {
  const doc = createSyntheticV2Doc();
  assert.equal(doc.entry.enteredQuantity, 5);
  assert.equal(doc.canonicalQuantity, 30);

  const resolved = resolveMealLogPortion(doc, '1 cucharadas');
  assert.ok(resolved);
  assert.equal(resolved.canonicalQuantity, 6);
  assert.equal(resolved.entry.enteredQuantity, 1);
  assert.deepEqual(resolved.entry.portionSnapshot, doc.entry.portionSnapshot);

  const updated = updateMealLogQuantityAndTime(doc, '1 cucharadas', doc.consumedAt, 1_700_000_050_000);
  assert.ok(updated);
  assert.equal(updated.id, doc.id);
  assert.equal(updated._deleted, doc._deleted);
  assert.deepEqual(updated.nutritionSnapshot, doc.nutritionSnapshot);
  assert.equal(updated.consumedAt, doc.consumedAt);
  assert.equal(updated.updatedAt, 1_700_000_050_000);
  assert.equal(updated.canonicalQuantity, 6);
  assert.equal(updated.entry.enteredQuantity, 1);
  assert.equal(updated.nameSnapshot, doc.nameSnapshot);
});

test('JSON serialize/reload and second edit using stored snapshot after template changed/deleted', () => {
  const doc = createSyntheticV2Doc();
  const firstEdit = updateMealLogQuantityAndTime(doc, '1 cucharadas', doc.consumedAt, 1_700_000_010_000);
  assert.ok(firstEdit);
  assert.equal(firstEdit.canonicalQuantity, 6);

  // Serialize and reload
  const serialized = JSON.stringify(firstEdit);
  const reloaded = JSON.parse(serialized);

  // Second edit using stored snapshot even if template is deleted/changed
  reloaded.templateId = null;
  const secondEdit = updateMealLogQuantityAndTime(reloaded, '2 cucharadas', reloaded.consumedAt, 1_700_000_020_000);
  assert.ok(secondEdit);
  assert.equal(secondEdit.canonicalQuantity, 12);
  assert.equal(secondEdit.entry.enteredQuantity, 2);
  assert.equal(secondEdit.id, doc.id);
  assert.equal(secondEdit._deleted, false);
  assert.deepEqual(secondEdit.nutritionSnapshot, doc.nutritionSnapshot);
  assert.equal(secondEdit.consumedAt, doc.consumedAt);
});

test('canonical g/ml editing and unit matching', () => {
  const gDoc = createSyntheticV2Doc();
  const gEdit = updateMealLogQuantityAndTime(gDoc, '45g', gDoc.consumedAt, 1_700_000_010_000);
  assert.ok(gEdit);
  assert.equal(gEdit.canonicalQuantity, 45);
  assert.equal(gEdit.entry.enteredQuantity, 45);
  assert.equal(gEdit.entry.portionSnapshot, undefined);

  // ml doc
  const mlDoc = createSyntheticV2Doc({
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'ml',
      nutritionPer100: { calories: 50, protein: 3, carbs: 5, fat: 2 },
    },
    canonicalQuantity: 200,
    entry: { enteredQuantity: 200 },
  });
  const mlEdit = updateMealLogQuantityAndTime(mlDoc, '250ml', mlDoc.consumedAt, 1_700_000_010_000);
  assert.ok(mlEdit);
  assert.equal(mlEdit.canonicalQuantity, 250);
  assert.equal(mlEdit.entry.enteredQuantity, 250);

  // unit mismatch: 'ml' on 'g' doc or 'g' on 'ml' doc returns null
  assert.equal(resolveMealLogPortion(gDoc, '100ml'), null);
  assert.equal(updateMealLogQuantityAndTime(gDoc, '100ml', gDoc.consumedAt, 1_700_000_020_000), null);
  assert.equal(resolveMealLogPortion(mlDoc, '100g'), null);
  assert.equal(updateMealLogQuantityAndTime(mlDoc, '100g', mlDoc.consumedAt, 1_700_000_020_000), null);
});

test('invalid quantity or unit rejects without modifying document', () => {
  const doc = createSyntheticV2Doc();

  for (const invalid of ['0 cucharadas', '-1 cucharadas', '0g', '-5g', 'abc cucharadas', 'NaN g']) {
    assert.equal(resolveMealLogPortion(doc, invalid), null);
    assert.equal(updateMealLogQuantityAndTime(doc, invalid, doc.consumedAt, 1_700_000_010_000), null);
  }

  // Mismatched named portion
  assert.equal(resolveMealLogPortion(doc, '1 taza'), null);
  assert.equal(updateMealLogQuantityAndTime(doc, '1 taza', doc.consumedAt, 1_700_000_010_000), null);
});

test('logToLoggedFood preserves projections with optional null, zero, and absent input', () => {
  const docFull = createSyntheticV2Doc();
  const adapterFull = logToLoggedFood(docFull);
  assert.equal(adapterFull.id, docFull.id);
  assert.equal(adapterFull.templateId, 'tmpl-v2-1');
  assert.equal(adapterFull.portion, '5 cucharadas');
  assert.equal(adapterFull.calories, 60);
  assert.equal(adapterFull.protein, 3);
  assert.equal(adapterFull.carbs, 9);
  assert.equal(adapterFull.fat, 1.5);
  assert.equal(adapterFull.fiber, 1.2);
  assert.equal(adapterFull.sodiumMg, 30);
  assert.equal(adapterFull.cholesterolMg, 3);

  const docZero = createSyntheticV2Doc({
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: {
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 0,
        fiber: 0,
        sodiumMg: 0,
        cholesterolMg: 0,
      },
    },
  });
  const adapterZero = logToLoggedFood(docZero);
  assert.equal(adapterZero.fiber, 0);
  assert.equal(adapterZero.sodiumMg, 0);
  assert.equal(adapterZero.cholesterolMg, 0);

  const docNull = createSyntheticV2Doc({
    templateId: null,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: {
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
        fiber: null,
        sodiumMg: null,
        cholesterolMg: null,
      },
    },
  });
  const adapterNull = logToLoggedFood(docNull);
  assert.equal(adapterNull.templateId, undefined);
  assert.equal('fiber' in adapterNull, false);
  assert.equal('sodiumMg' in adapterNull, false);
  assert.equal('cholesterolMg' in adapterNull, false);

  const docAbsent = createSyntheticV2Doc({
    templateId: null,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    entry: { enteredQuantity: 30 },
  });
  const adapterAbsent = logToLoggedFood(docAbsent);
  assert.equal(adapterAbsent.templateId, undefined);
  assert.equal(adapterAbsent.portion, '30g');
  assert.equal(adapterAbsent.fiber, undefined);
  assert.equal(adapterAbsent.sodiumMg, undefined);
  assert.equal(adapterAbsent.cholesterolMg, undefined);
});

test('portable server fixture is accepted before and after a historical quantity edit', async () => {
  const { readFileSync } = await import('node:fs');
  const { isMealLogDoc } = await import('../src/services/sync/types.ts');
  const { document, expectedNutrition } = JSON.parse(readFileSync(
    new URL('../../../packages/balance-domain/fixtures/canonical-spoon.json', import.meta.url), 'utf8'));
  assert.equal(isMealLogDoc(document), true);
  const projected = logToLoggedFood(document);
  for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber']) {
    assert.ok(Math.abs(projected[key] - expectedNutrition[key]) <= 1e-8);
  }
  const updated = updateMealLogQuantityAndTime(document, '2 cucharada', document.consumedAt, document.updatedAt + 1);
  assert.equal(isMealLogDoc(updated), true);
  assert.equal(updated.canonicalQuantity, 12);
  assert.equal(isMealLogDoc({ ...updated, canonicalQuantity: 13 }), false);
});
