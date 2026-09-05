import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FoodLibraryMutationError,
  createPersonalTemplate,
  deletePersonalTemplate,
  mergeEditedTemplateDetails,
  nextTemplateTimestamp,
  updatePersonalTemplate
} from '../src/lib/food-library-documents.ts';
import {
  parseFoodPortion,
  resolveMealLogPortion,
  updateMealLogQuantityAndTime
} from '../src/lib/food-portions.ts';

const details = {
  schemaVersion: 2,
  canonicalUnit: 'g',
  nutritionPer100: {
    calories: 160,
    protein: 8,
    carbs: 24,
    fat: 4,
    fiber: 3,
    sodiumMg: 210,
    cholesterolMg: 0
  },
  portions: [],
  category: 'Panadería',
  typicalTime: '08:00'
};

test('creates a personal template with the canonical sync shape', () => {
  const doc = createPersonalTemplate('food-1', '  Pan integral  ', details, 1000);
  assert.deepEqual(doc, {
    id: 'food-1',
    name: 'Pan integral',
    isOfficial: false,
    details,
    updatedAt: 1000,
    _deleted: false
  });
});

test('updates with a timestamp strictly newer than the current document', () => {
  const current = createPersonalTemplate('food-1', 'Pan', details, 2000);
  const updated = updatePersonalTemplate(current, 'Pan integral', details, 2000);
  assert.equal(updated.name, 'Pan integral');
  assert.equal(updated.updatedAt, 2001);
  assert.equal(updated._deleted, false);
  assert.equal(nextTemplateTimestamp(3000, 2500), 3001);
});

test('soft deletes personal foods without changing their nutrition snapshot', () => {
  const current = createPersonalTemplate('food-1', 'Pan', details, 2000);
  const deleted = deletePersonalTemplate(current, 2100);
  assert.equal(deleted._deleted, true);
  assert.equal(deleted.updatedAt, 2100);
  assert.deepEqual(deleted.details, details);
});

test('rejects mutation and deletion of official foods', () => {
  const official = {
    ...createPersonalTemplate('official-1', 'Manzana', details, 1000),
    isOfficial: true
  };
  for (const mutate of [
    () => updatePersonalTemplate(official, 'Otra', details, 2000),
    () => deletePersonalTemplate(official, 2000)
  ]) {
    assert.throws(mutate, (error) => {
      assert.ok(error instanceof FoodLibraryMutationError);
      assert.equal(error.code, 'official-food');
      return true;
    });
  }
});

test('rejects blank names and missing foods', () => {
  assert.throws(
    () => createPersonalTemplate('food-1', '   ', details, 1000),
    (error) => error instanceof FoodLibraryMutationError && error.code === 'invalid-name'
  );
  assert.throws(
    () => deletePersonalTemplate(undefined, 1000),
    (error) => error instanceof FoodLibraryMutationError && error.code === 'missing-food'
  );
});

test('normalizes canonical g/ml portions', () => {
  assert.deepEqual(parseFoodPortion('1,5 g'), { canonicalQuantity: 1.5, unit: 'g', normalized: '1.5g' });
  assert.deepEqual(parseFoodPortion(' 250 ml '), { canonicalQuantity: 250, unit: 'ml', normalized: '250ml' });
});

test('rejects zero and unsupported portions instead of applying a silent fallback', () => {
  assert.equal(parseFoodPortion('0g'), null);
  assert.equal(parseFoodPortion('1 taza'), null);
  assert.equal(parseFoodPortion('una cucharada'), null);
});


test('preserves named portions when editing a template in the same canonical unit', () => {
  const portions = [{ id: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }];
  const current = { ...details, portions };
  const edited = {
    ...details,
    nutritionPer100: { ...details.nutritionPer100, calories: 170 },
    portions: []
  };
  const merged = mergeEditedTemplateDetails(current, edited);
  assert.deepEqual(merged.portions, portions);
  assert.equal(merged.nutritionPer100.calories, 170);
});

test('resolves named portion edits from the immutable meal-log snapshot', () => {
  const doc = {
    id: 'log-1',
    templateId: 'food-1',
    nameSnapshot: 'Pan',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: details.nutritionPer100
    },
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }
    },
    consumedAt: 1,
    updatedAt: 1,
    _deleted: false
  };
  assert.deepEqual(resolveMealLogPortion(doc, '4 slice'), {
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }
    }
  });
  assert.equal(resolveMealLogPortion(doc, '5 slice')?.canonicalQuantity, 137.5);
});

test('updates meal-log quantity and time without mutating its historical snapshots', () => {
  const nutritionSnapshot = {
    schemaVersion: 2,
    canonicalUnit: 'g',
    nutritionPer100: details.nutritionPer100
  };
  const doc = {
    id: 'log-1',
    templateId: 'food-1',
    nameSnapshot: 'Pan histórico',
    nutritionSnapshot,
    canonicalQuantity: 110,
    entry: {
      enteredQuantity: 4,
      portionSnapshot: { portionId: 'slice', name: 'slice', portionQuantity: 1, canonicalQuantity: 27.5 }
    },
    consumedAt: 1,
    updatedAt: 1,
    _deleted: false
  };

  const updated = updateMealLogQuantityAndTime(doc, '5 slice', 2, 3);

  assert.equal(updated?.canonicalQuantity, 137.5);
  assert.equal(updated?.entry.enteredQuantity, 5);
  assert.equal(updated?.consumedAt, 2);
  assert.equal(updated?.updatedAt, 3);
  assert.equal(updated?.nameSnapshot, doc.nameSnapshot);
  assert.strictEqual(updated?.nutritionSnapshot, nutritionSnapshot);
});
