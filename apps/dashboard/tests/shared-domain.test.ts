import assert from 'node:assert/strict';
import test from 'node:test';
import type { MealLogDoc } from '../src/types/meal-log.ts';
import type { FoodLogState } from '../src/features/food-log/domain/food-log-state.ts';
import { nutritionForDocument } from '../src/features/food-log/domain/food-log-state.ts';
import { epochForChileDateTime, toDateId } from '../src/features/food-log/domain/time.ts';
import { executeFoodLogCommand, type ExecutionContext } from '../src/features/food-log/commands/execute-command.ts';

const testDateId = '2026-08-20';
const baseConsumedAt = epochForChileDateTime(testDateId, '12:00')!;

const context: ExecutionContext = {
  now: () => 1_800_000_000_000,
  createId: (() => {
    let next = 0;
    return () => `new-${++next}`;
  })(),
};

function createSyntheticV2Doc(overrides: Partial<MealLogDoc> = {}): MealLogDoc {
  return {
    id: 'doc-synthetic-v2',
    templateId: 'tmpl-v2-1',
    nameSnapshot: 'Avena con leche',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: {
        calories: 200,
        protein: 10,
        carbs: 30,
        fat: 5,
        fiber: 4,
        sodiumMg: 100,
        cholesterolMg: 10,
      },
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
    consumedAt: baseConsumedAt,
    updatedAt: 1_700_000_000_000,
    _deleted: false,
    ...overrides,
  };
}

function createState(documents: MealLogDoc[], cursorId?: string): FoodLogState {
  const selectedDateId = documents[0] ? toDateId(documents[0].consumedAt) : testDateId;
  return {
    documents,
    selectedDateId,
    cursorId: cursorId ?? documents[0]?.id ?? null,
    selectionAnchorId: null,
    mode: 'normal',
    register: null,
    history: [],
    future: [],
    lastChange: null,
  };
}

test('synthetic V2 doc 5 cucharadas=30g edits to 1 => 6g and preserves identity/tombstone/snapshot/time', () => {
  const doc = createSyntheticV2Doc();
  assert.equal(doc.entry.enteredQuantity, 5);
  assert.equal(doc.canonicalQuantity, 30);

  const initialNutrition = nutritionForDocument(doc);
  assert.equal(initialNutrition.calories, 60);
  assert.equal(initialNutrition.protein, 3);
  assert.equal(initialNutrition.carbs, 9);
  assert.equal(initialNutrition.fat, 1.5);

  const result = executeFoodLogCommand(createState([doc]), { type: 'set-quantity', quantity: 1, unit: 'g' }, context);
  assert.equal(result.changedDocuments, true);

  const updated = result.state.documents.find((d) => d.id === doc.id);
  assert.ok(updated);
  assert.equal(updated.id, doc.id);
  assert.equal(updated._deleted, doc._deleted);
  assert.deepEqual(updated.nutritionSnapshot, doc.nutritionSnapshot);
  assert.equal(updated.consumedAt, doc.consumedAt);
  assert.equal(updated.updatedAt, context.now());
  assert.equal(updated.canonicalQuantity, 6);
  assert.equal(updated.entry.enteredQuantity, 1);
  assert.deepEqual(updated.entry.portionSnapshot, doc.entry.portionSnapshot);

  const updatedNutrition = nutritionForDocument(updated);
  assert.equal(updatedNutrition.calories, 12);
  assert.equal(updatedNutrition.protein, 0.6);
  assert.ok(Math.abs(updatedNutrition.carbs - 1.8) < 1e-9);
  assert.ok(Math.abs(updatedNutrition.fat - 0.3) < 1e-9);
});

test('JSON serialize/reload and second edit using stored snapshot after template changed/deleted', () => {
  const doc = createSyntheticV2Doc();
  const firstResult = executeFoodLogCommand(createState([doc]), { type: 'set-quantity', quantity: 1, unit: 'g' }, context);
  const firstEdit = firstResult.state.documents.find((d) => d.id === doc.id)!;
  assert.equal(firstEdit.canonicalQuantity, 6);

  // Serialize and reload
  const serialized = JSON.stringify(firstEdit);
  const reloaded: MealLogDoc = JSON.parse(serialized);

  // Second edit using stored snapshot even if template is deleted/changed
  reloaded.templateId = null;
  const secondResult = executeFoodLogCommand(createState([reloaded]), { type: 'set-quantity', quantity: 2, unit: 'g' }, context);
  assert.equal(secondResult.changedDocuments, true);

  const secondEdit = secondResult.state.documents.find((d) => d.id === doc.id);
  assert.ok(secondEdit);
  assert.equal(secondEdit.canonicalQuantity, 12);
  assert.equal(secondEdit.entry.enteredQuantity, 2);
  assert.equal(secondEdit.id, doc.id);
  assert.equal(secondEdit._deleted, false);
  assert.deepEqual(secondEdit.nutritionSnapshot, doc.nutritionSnapshot);
  assert.equal(secondEdit.consumedAt, doc.consumedAt);
});

test('canonical g/ml editing and unit matching', () => {
  const gDoc = createSyntheticV2Doc({
    id: 'g-canonical-doc',
    entry: { enteredQuantity: 100 },
    canonicalQuantity: 100,
  });
  const gResult = executeFoodLogCommand(createState([gDoc]), { type: 'set-quantity', quantity: 150, unit: 'g' }, context);
  assert.equal(gResult.changedDocuments, true);
  const gUpdated = gResult.state.documents.find((d) => d.id === 'g-canonical-doc')!;
  assert.equal(gUpdated.canonicalQuantity, 150);
  assert.equal(gUpdated.entry.enteredQuantity, 150);

  // ml doc
  const mlDoc = createSyntheticV2Doc({
    id: 'ml-canonical-doc',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'ml',
      nutritionPer100: { calories: 50, protein: 3, carbs: 5, fat: 2 },
    },
    canonicalQuantity: 200,
    entry: { enteredQuantity: 200 },
  });
  const mlResult = executeFoodLogCommand(createState([mlDoc]), { type: 'set-quantity', quantity: 250, unit: 'ml' }, context);
  assert.equal(mlResult.changedDocuments, true);
  const mlUpdated = mlResult.state.documents.find((d) => d.id === 'ml-canonical-doc')!;
  assert.equal(mlUpdated.canonicalQuantity, 250);
  assert.equal(mlUpdated.entry.enteredQuantity, 250);

  // Unit conversion mismatch: 'ml' on 'g' doc or 'g' on 'ml' doc
  const badG = executeFoodLogCommand(createState([gDoc]), { type: 'set-quantity', quantity: 100, unit: 'ml' }, context);
  assert.equal(badG.changedDocuments, false);
  assert.equal(badG.message, 'unit conversion unavailable: ml');

  const badMl = executeFoodLogCommand(createState([mlDoc]), { type: 'set-quantity', quantity: 100, unit: 'g' }, context);
  assert.equal(badMl.changedDocuments, false);
  assert.equal(badMl.message, 'unit conversion unavailable: g');
});

test('invalid quantity or unit rejects without modifying document', () => {
  const doc = createSyntheticV2Doc();
  const state = createState([doc]);

  for (const invalidQuantity of [0, -1, -50, NaN, Infinity]) {
    const res = executeFoodLogCommand(state, { type: 'set-quantity', quantity: invalidQuantity, unit: 'g' }, context);
    assert.equal(res.changedDocuments, false);
    assert.equal(res.message, 'invalid quantity');
    assert.equal(res.state.documents[0].canonicalQuantity, 30);
  }
});

test('nutritionForDocument preserves projections with optional null, zero, and absent input', () => {
  // 1. All optional fields present with positive values
  const docFull = createSyntheticV2Doc();
  const nFull = nutritionForDocument(docFull);
  assert.equal(nFull.calories, 60);
  assert.equal(nFull.protein, 3);
  assert.equal(nFull.carbs, 9);
  assert.equal(nFull.fat, 1.5);

  // 2. Zero values
  const docZero = createSyntheticV2Doc({
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodiumMg: 0, cholesterolMg: 0 },
    },
  });
  const nZero = nutritionForDocument(docZero);
  assert.equal(nZero.calories, 0);
  assert.equal(nZero.protein, 0);
  assert.equal(nZero.carbs, 0);
  assert.equal(nZero.fat, 0);

  // 3. Null optional values
  const docNull = createSyntheticV2Doc({
    templateId: null,
    provenance: null,
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: {
        calories: 100,
        protein: 10,
        carbs: 15,
        fat: 2,
        fiber: null,
        sodiumMg: null,
        cholesterolMg: null,
        extendedNutrition: null,
      },
    },
  });
  const nNull = nutritionForDocument(docNull);
  assert.equal(nNull.calories, 30);
  assert.equal(nNull.protein, 3);
  assert.equal(nNull.carbs, 4.5);
  assert.equal(nNull.fat, 0.6);

  // 4. Absent optional values
  const docAbsent = createSyntheticV2Doc({
    templateId: null,
    canonicalQuantity: 50,
    entry: { enteredQuantity: 50 },
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 150, protein: 6, carbs: 20, fat: 4 },
    },
  });
  const nAbsent = nutritionForDocument(docAbsent);
  assert.equal(nAbsent.calories, 75);
  assert.equal(nAbsent.protein, 3);
  assert.equal(nAbsent.carbs, 10);
  assert.equal(nAbsent.fat, 2);
});

test('portable server fixture is accepted before and after a historical quantity edit', async () => {
  const { readFileSync } = await import('node:fs');
  const { isMealLogDoc } = await import('../src/types/meal-log.ts');
  const { document, expectedNutrition } = JSON.parse(readFileSync(
    new URL('../../../packages/balance-domain/fixtures/canonical-spoon.json', import.meta.url), 'utf8'));
  assert.equal(isMealLogDoc(document), true);
  const projected = nutritionForDocument(document);
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    assert.ok(Math.abs(projected[key] - expectedNutrition[key]) <= 1e-8);
  }
  const result = executeFoodLogCommand(createState([document]), { type: 'set-quantity', quantity: 2, unit: 'g' }, context);
  const updated = result.state.documents[0];
  assert.equal(isMealLogDoc(updated), true);
  assert.equal(updated.canonicalQuantity, 12);
  assert.equal(isMealLogDoc({ ...updated, canonicalQuantity: 13 }), false);
});
