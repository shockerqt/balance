import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMealDayProjector, createMealDaySubscriptions, emptyDayLog } from '../src/lib/meal-day-projection.ts';
import { epochForChileDateTime } from '../src/lib/dates.ts';

const meal = (id, date = '2026-11-06') => ({
  id, templateId: null, nameSnapshot: id,
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 1 } },
  canonicalQuantity: 100, entry: { enteredQuantity: 100 },
  consumedAt: epochForChileDateTime(date, '08:00'), updatedAt: 1, _deleted: false,
});

test('only affected days allocate new projection snapshots; moves, deletion and replacement invalidate both dates', () => {
  const project = createMealDayProjector();
  const first = meal('a'), second = meal('b'), other = meal('c', '2026-11-05');
  const initial = project([first, second, other]);
  assert.equal(project([first, second, other]), initial);
  const edited = { ...first, nameSnapshot: 'Edited', updatedAt: 2 };
  const changed = project([edited, second, other]);
  assert.notEqual(changed['2026-11-06'], initial['2026-11-06']);
  assert.equal(changed['2026-11-05'], initial['2026-11-05']);
  assert.equal(changed['2026-11-06'].foods[1], initial['2026-11-06'].foods[1]);
  assert.deepEqual(changed['2026-11-06'].foods.map(f => f.id), ['a', 'b']);
  const moved = { ...edited, consumedAt: other.consumedAt };
  const movedDays = project([moved, second, other]);
  assert.deepEqual(movedDays['2026-11-06'].foods.map(f => f.id), ['b']);
  assert.deepEqual(movedDays['2026-11-05'].foods.map(f => f.id), ['a', 'c']);
  const deleted = project([{ ...moved, _deleted: true }, second, other]);
  assert.equal(deleted['2026-11-06'], movedDays['2026-11-06']);
  assert.deepEqual(deleted['2026-11-05'].foods.map(f => f.id), ['c']);
  assert.deepEqual(project([]), {});
});

test('projection uses Chilean date identity and preserves unknown nutrients versus zero', () => {
  const project = createMealDayProjector();
  const first = meal('a');
  const zeroFiber = { ...meal('b'), nutritionSnapshot: { ...first.nutritionSnapshot,
    nutritionPer100: { ...first.nutritionSnapshot.nutritionPer100, fiber: 0 } } };
  const day = project([first, zeroFiber])['2026-11-06'];
  assert.equal(day.foods[0].fiber, undefined);
  assert.equal(day.foods[1].fiber, 0);
  assert.equal(day.foods[0].time, '08:00');
});

test('subscriptions notify only changed dates, install atomically, and release listeners', () => {
  const project = createMealDayProjector();
  const first = meal('a'), other = meal('b', '2026-11-05');
  const initial = project([first, other]);
  const store = createMealDaySubscriptions(initial);
  const untouched = store.get('2026-11-05');
  const empty = store.get('2040-01-01');
  assert.equal(store.get('2040-01-01'), empty);
  let changedCalls = 0, untouchedCalls = 0, emptyCalls = 0;
  const unsub = store.subscribe('2026-11-06', () => {
    changedCalls++;
    assert.equal(store.get('2026-11-05'), untouched);
    assert.equal(store.get('2026-11-06').foods[0].name, 'Edited');
  });
  store.subscribe('2026-11-05', () => untouchedCalls++);
  store.subscribe('2040-01-01', () => emptyCalls++);
  store.publish(project([{ ...first, nameSnapshot: 'Edited' }, other]));
  store.publish(project([{ ...first, nameSnapshot: 'Edited' }, other]));
  assert.equal(changedCalls, 2);
  assert.equal(untouchedCalls, 0);
  assert.equal(emptyCalls, 0);
  assert.equal(store.get('2040-01-01'), empty);
  unsub();
  store.publish(project([other]));
  assert.equal(changedCalls, 2);
  assert.deepEqual(store.get('2026-11-06'), emptyDayLog('2026-11-06'));
});

test('replacing the account adapter exposes no prior account data', () => {
  const old = createMealDaySubscriptions({ '2026-11-06': { ...emptyDayLog('2026-11-06'), foods: [{ id: 'private' }] } });
  const next = createMealDaySubscriptions();
  assert.equal(old.get('2026-11-06').foods.length, 1);
  assert.equal(next.get('2026-11-06').foods.length, 0);
});
