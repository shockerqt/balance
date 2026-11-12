import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMealGroups } from '../src/lib/meal-groups.ts';

const food = (id, time, calories) => ({ id, name: id, portion: '100g', calories, protein: 1, carbs: 1, fat: 1, time });

test('only hours with foods appear, in order, each with its total and foods', () => {
  const groups = buildMealGroups([food('c', '13:10', 620), food('a', '08:00', 310), food('b', '08:20', 105), food('d', '17:00', 225)]);
  assert.deepEqual(groups.map(g => [g.hour, g.calories, g.foods.map(f => f.id).join('')]), [['08:00', 415, 'ab'], ['13:00', 620, 'c'], ['17:00', 225, 'd']]);
  assert.deepEqual(groups[0].ids, ['a', 'b']);
  assert.deepEqual(groups.map(g => g.key), ['h:08:00', 'h:13:00', 'h:17:00']);
});

test('an empty day has no groups, so the feed shows its empty state', () => {
  assert.deepEqual(buildMealGroups([]), []);
});

test('foods follow their exact time inside a group, and a missing time does not throw', () => {
  const groups = buildMealGroups([food('late', '08:25', 1), food('early', '07:40', 1), food('none', '', 1), food('undef', undefined, 1)]);
  assert.deepEqual(groups.map(g => g.hour), ['08:00', '12:00']);
  assert.deepEqual(groups[0].foods.map(f => f.id), ['early', 'late']);
  assert.deepEqual(groups[1].foods.map(f => f.id), ['none', 'undef']);
});
