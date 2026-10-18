import test from 'node:test';
import assert from 'node:assert/strict';
import { projectInterfaceDays, acceptInterfaceEvent, weightGrams } from '../src/components/meal/native/interface-contract.ts';
import { createFoodEntry } from '../src/components/meal/native/food-entry-contract.ts';
import { DEFAULT_TARGETS } from '../src/lib/day-targets.ts';

const date = '2026-10-18';
const manual = { date, time: '23:45', quantity: '150', name: 'Prueba', unit: 'g', templateId: '',
  nutrients: { calories: '120', protein: '3', carbs: '24', fat: '1', fiber: '' } };
const doc = createFoodEntry(manual, [], 'one', 10);
const food = { id: 'one', name: 'Prueba', portion: '150g', time: '23:45', calories: 180, protein: 4.5, carbs: 36, fat: 1.5 };
const logs = { [date]: { ...DEFAULT_TARGETS, dateId: date, displayDate: '', foods: [food] } };
const event = { session: 'current', sequence: 1, commandRevision: 4, date, action: 'edit-save', ids: ['one'], time: '08:15', input: { quantity: '200', mode: 'canonical', revision: 10 } };
const accepts = e => acceptInterfaceEvent(e, 'current', 0, 4, date, [doc]);

test('labels per portion normalize once, retain unknown fiber and exact per100 inputs', () => {
  const label = createFoodEntry({ ...manual, labelBasis: 'portion', labelSize: '30' }, [], 'label', 10);
  assert.deepEqual(label.nutritionSnapshot.nutritionPer100, { calories: 400, protein: 10, carbs: 80, fat: 100 / 30 });
  assert.equal(label.canonicalQuantity, 150);
  assert.equal('fiber' in label.nutritionSnapshot.nutritionPer100, false);
  const explicit = createFoodEntry({ ...manual, nutrients: { ...manual.nutrients, fiber: '0', sodiumMg: '3.27' } }, [], 'zero', 10);
  assert.equal(explicit.nutritionSnapshot.nutritionPer100.fiber, 0);
  assert.equal(explicit.nutritionSnapshot.nutritionPer100.sodiumMg, 3.27);
  for (const p of [{ labelBasis: 'portion', labelSize: '0' }, { labelBasis: 'portion', labelSize: '' }, { labelBasis: 'unknown' }, { labelBasis: 'portion', labelSize: '0.' + '0'.repeat(307) + '1' }]) {
    assert.throws(() => createFoodEntry({ ...manual, ...p }, [], 'bad'));
  }
});

test('projection distinguishes empty, weight-only, unknown, partial and explicit zero nutrition', () => {
  const second = { ...food, id: 'two', fiber: 0 };
  const days = projectInterfaceDays({ ...logs, [date]: { ...logs[date], foods: [food, second] } }, { '2026-10-17': { weightGrams: 72500 } }, [doc]);
  assert.equal(days['2026-10-17'].recorded, false);
  assert.equal(days['2026-10-17'].weightKg, 72.5);
  assert.equal(days[date].details.find(f => f.label === 'Fibra').value, 0);
  assert.equal(days[date].details.find(f => f.label === 'Fibra').partial, true);
  assert.equal(days[date].details.find(f => f.label === 'Sodio').value, null);
  assert.equal(days[date].totals.calories, 360);
  assert.equal(days[date].foods[0].revision, 10);
  assert.equal(days[date].foods[0].canonicalQuantity, 150);
  assert.equal(projectInterfaceDays(logs, {}, [doc])[date].details.find(f => f.label === 'Fibra').value, null);
});

test('native edits require a live historical revision, valid conversion and existing Chilean time', () => {
  assert.equal(accepts(event), true);
  for (const change of [{ session: 'old' }, { sequence: 0 }, { commandRevision: 3 }, { ids: ['gone'] },
    { time: '24:00' }, { date: '2026-02-30' }, { input: { ...event.input, revision: 9 } },
    { input: { ...event.input, mode: 'portion' } }, { input: { ...event.input, quantity: '0' } },
    { input: { ...event.input, quantity: '9'.repeat(309) } }, { date: '2026-09-06', time: '00:30' }]) assert.equal(accepts({ ...event, ...change }), false);
  const dense = { ...doc, nutritionSnapshot: { ...doc.nutritionSnapshot, nutritionPer100: { ...doc.nutritionSnapshot.nutritionPer100, calories: 400 } } };
  assert.equal(acceptInterfaceEvent({ ...event, input: { ...event.input, quantity: '9'.repeat(308) } }, 'current', 0, 4, date, [dense]), false);
  assert.equal(acceptInterfaceEvent(event, 'current', 0, 4, date, [{ ...doc, _deleted: true }]), false);
});

test('weight native boundary preserves backend resolution and rejects future and malformed actions', () => {
  for (const [raw, expected] of [['1', 1000], ['72,5', 72500], ['500', 500000], ['72.55', null], ['500.1', null], ['0', null], ['NaN', null], [null, null]]) assert.equal(weightGrams(raw), expected);
  const weight = { ...event, action: 'weight-save', input: { quantity: '72,5' } };
  assert.equal(accepts(weight), true);
  assert.equal(accepts({ ...weight, date: '2026-10-19' }), false);
  assert.equal(accepts({ ...weight, input: { quantity: '72.55' } }), false);
  assert.equal(accepts({ ...event, action: 'preference', input: { enabled: true } }), true);
  assert.equal(accepts({ ...event, action: 'preference', input: { enabled: 'true' } }), false);
  assert.equal(accepts({ ...event, action: 'replace-data' }), false);
});
