import assert from 'node:assert/strict';
import test from 'node:test';
import type { MealLogDoc } from '../src/types/meal-log.ts';
import { isMealLogDoc } from '../src/types/meal-log.ts';
import {
  materializeMealLogChanges,
  mergeMealLogs,
} from '../src/features/food-log/services/meal-log-sync.ts';

function row(overrides: Partial<MealLogDoc> = {}): MealLogDoc {
  return {
    id: 'log-a',
    templateId: 'template-a',
    nameSnapshot: 'Avena',
    nutritionSnapshot: {
      schemaVersion: 2,
      canonicalUnit: 'g',
      nutritionPer100: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    canonicalQuantity: 100,
    entry: { enteredQuantity: 100 },
    consumedAt: 1_700_000_000_000,
    updatedAt: 100,
    _deleted: false,
    ...overrides,
  };
}

test('restored command snapshots receive a fresh LWW timestamp', () => {
  const before = [row({ updatedAt: 500, canonicalQuantity: 100, entry: { enteredQuantity: 100 } })];
  const after = [row({ updatedAt: 100, canonicalQuantity: 125, entry: { enteredQuantity: 125 } })];
  const result = materializeMealLogChanges(before, after, 400);

  assert.equal(result.pushDocuments.length, 1);
  assert.equal(result.documents[0].canonicalQuantity, 125);
  assert.equal(result.documents[0].entry.enteredQuantity, 125);
  assert.ok(result.documents[0].updatedAt > 500);
});

test('a document removed by undo is persisted as a tombstone', () => {
  const before = [row({ id: 'created-log', updatedAt: 500 })];
  const result = materializeMealLogChanges(before, [], 600);

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]._deleted, true);
  assert.equal(result.pushDocuments[0]._deleted, true);
  assert.ok(result.pushDocuments[0].updatedAt > 500);
});

test('food replacement becomes old tombstone plus new canonical identity', () => {
  const before = [row({ id: 'old-log', templateId: 'template-a', updatedAt: 500 })];
  const after = [row({
    id: 'old-log',
    templateId: 'template-b',
    nameSnapshot: 'Pan',
    updatedAt: 510,
  })];
  const result = materializeMealLogChanges(before, after, 600, () => 'replacement-log');

  assert.equal(result.documents.length, 2);
  assert.equal(result.documents.find((document) => document.id === 'old-log')?._deleted, true);
  assert.equal(result.documents.find((document) => document.id === 'replacement-log')?.templateId, 'template-b');
  assert.deepEqual(result.replacedIds, { 'old-log': 'replacement-log' });
  assert.deepEqual(result.pushDocuments.map((document) => document.id), ['old-log', 'replacement-log']);
});

test('server document wins an equal-timestamp merge', () => {
  const local = row({ updatedAt: 900, canonicalQuantity: 100, entry: { enteredQuantity: 100 } });
  const remote = row({ updatedAt: 900, canonicalQuantity: 130, entry: { enteredQuantity: 130 } });
  const merged = mergeMealLogs([local], [remote]);
  assert.equal(merged[0].canonicalQuantity, 130);
});

test('named portion snapshots survive persistence materialization', () => {
  const portionSnapshot = {
    portionId: 'slice',
    name: 'slice',
    portionQuantity: 1,
    canonicalQuantity: 27.5,
  };
  const before = [row({
    updatedAt: 500,
    canonicalQuantity: 110,
    entry: { enteredQuantity: 4, portionSnapshot },
  })];
  const after = [row({
    updatedAt: 100,
    canonicalQuantity: 137.5,
    entry: { enteredQuantity: 5, portionSnapshot },
  })];
  const result = materializeMealLogChanges(before, after, 600);
  const persisted = result.pushDocuments[0];

  assert.equal(persisted.canonicalQuantity, 137.5);
  assert.equal(persisted.entry.enteredQuantity, 5);
  assert.deepEqual(persisted.entry.portionSnapshot, portionSnapshot);
  assert.equal(isMealLogDoc(persisted), true);
});

test('runtime validation rejects inconsistent portion conversion', () => {
  const invalid = row({
    canonicalQuantity: 100,
    entry: {
      enteredQuantity: 5,
      portionSnapshot: {
        portionId: 'slice',
        name: 'slice',
        portionQuantity: 1,
        canonicalQuantity: 27.5,
      },
    },
  });
  assert.equal(isMealLogDoc(invalid), false);
});
