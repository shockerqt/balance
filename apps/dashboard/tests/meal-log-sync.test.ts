import assert from 'node:assert/strict';
import test from 'node:test';
import type { MealLogDoc } from '../src/types/meal-log.ts';
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
      schemaVersion: 1,
      baseAmount: 100,
      unit: 'g',
      nutrition: { calories: 100, protein: 10, carbs: 10, fat: 2 },
    },
    quantity: 100,
    consumedAt: 1_700_000_000_000,
    updatedAt: 100,
    _deleted: false,
    ...overrides,
  };
}

test('restored command snapshots receive a fresh LWW timestamp', () => {
  const before = [row({ updatedAt: 500, quantity: 100 })];
  const after = [row({ updatedAt: 100, quantity: 125 })];
  const result = materializeMealLogChanges(before, after, 400);

  assert.equal(result.pushDocuments.length, 1);
  assert.equal(result.documents[0].quantity, 125);
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
  const local = row({ updatedAt: 900, quantity: 100 });
  const remote = row({ updatedAt: 900, quantity: 130 });
  const merged = mergeMealLogs([local], [remote]);
  assert.equal(merged[0].quantity, 130);
});
