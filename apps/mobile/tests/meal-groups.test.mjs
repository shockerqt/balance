import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMealGroupRows } from '../src/lib/meal-groups.ts';

const food = (id, time, calories) => ({ id, name: id, portion: '100g', calories, protein: 1, carbs: 1, fat: 1, time });

test('only hours with foods appear, in order, each with its total and card edges', () => {
  const rows = buildMealGroupRows([food('c', '13:10', 620), food('a', '08:00', 310), food('b', '08:20', 105), food('d', '17:00', 225)]);
  assert.deepEqual(rows.map(r => r.kind === 'header' ? `${r.hour}:${r.calories}` : `${r.food.id}${r.first ? '^' : ''}${r.last ? '$' : ''}`),
    ['08:00:415', 'a^', 'b$', '13:00:620', 'c^$', '17:00:225', 'd^$']);
  assert.deepEqual(rows[0].ids, ['a', 'b']);
});

test('an empty day has no rows, so the feed shows its empty state', () => {
  assert.deepEqual(buildMealGroupRows([]), []);
});

test('foods inside a group follow their exact time, and keys are stable per food', () => {
  const rows = buildMealGroupRows([food('late', '08:25', 1), food('early', '07:40', 1)]);
  assert.deepEqual(rows.filter(r => r.kind === 'food').map(r => r.food.id), ['early', 'late']);
  assert.deepEqual(rows.map(r => r.key), ['h:08:00', 'f:early', 'f:late']);
});
