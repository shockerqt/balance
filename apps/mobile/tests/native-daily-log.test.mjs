import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptDailyEvent, projectDays } from '../src/components/meal/native/daily-log-contract.ts';
import { DEFAULT_TARGETS } from '../src/lib/day-targets.ts';
const date = '2026-10-11';
const food = { id: 'one', name: 'Avena', portion: '42 g', time: '08:15', calories: 156.78, protein: 5.87, carbs: 24.1, fat: 3.5, fiber: 4.2 };
const logs = { [date]: { dateId: date, displayDate: '', ...DEFAULT_TARGETS, foods: [food, { ...food, id: 'two', time: '07:55' }] } };
const event = { session: 'current', sequence: 3, commandRevision: 0, date, action: 'edit', ids: ['one'] };
test('queued callbacks cannot mutate another date, account, removed food or replayed event', () => {
  assert.equal(acceptDailyEvent(event, 'current', 2, date, logs, 0), true);
  for (const candidate of [{ ...event, session: 'old' }, { ...event, sequence: 2 }, { ...event, sequence: NaN }, { ...event, date: '2026-10-10' }, { ...event, ids: ['removed'] }, { ...event, ids: ['one', 'one'] }, { ...event, action: 'unknown' }, { ...event, date: '2026-02-30' }, { ...event, time: '24:00' }]) {
    assert.equal(acceptDailyEvent(candidate, 'current', 2, date, logs, 0), false);
  }
  assert.equal(acceptDailyEvent(event, 'current', 2, date, {}, 0), false);
});
test('settled date callbacks and complete batch moves cross the bridge safely', () => {
  assert.equal(acceptDailyEvent({ ...event, action: 'date', date: '2024-02-29' }, 'current', 2, date, logs, 0), true);
  assert.equal(acceptDailyEvent({ ...event, action: 'move', ids: ['one', 'two'], time: '23:59' }, 'current', 2, date, logs, 0), true);
  assert.equal(acceptDailyEvent({ ...event, action: 'move', ids: ['one', 'two'] }, 'current', 2, date, logs, 0), false);
});
test('native projections keep domain precision and each row in dense hour groups', () => {
  const dense = { ...logs[date], foods: Array.from({ length: 300 }, (_, i) => ({ ...food, id: `food-${i}` })) };
  const day = projectDays({ [date]: dense }, { [date]: { weightGrams: 72500 } })[date];
  assert.equal(day.foods.length, 300);
  assert.equal(new Set(day.foods.map(f => f.id)).size, 300);
  assert.ok(Math.abs(day.progress - 300 * 156.78 / 2200) < 1e-10);
  assert.equal(day.weight, '72,5 kg');
  assert.equal(projectDays(logs, {})[date].foods[0].id, 'two');
});
test('weight-only days and absent nutrition are projected without inventing meals', () => {
  const day = projectDays({}, { [date]: { weightGrams: 70000 } })[date];
  assert.equal(day.foods.length, 0);
  assert.equal(day.calories, '0');
  assert.equal(day.weight, '70 kg');
  assert.equal(day.macros.length, 4);
});

test('an external calendar command invalidates queued native navigation, including away-and-back', () => {
  const navigation = { ...event, action: 'date', date: '2026-10-10' };
  assert.equal(acceptDailyEvent(navigation, 'current', 2, date, logs, 1), false);
  assert.equal(acceptDailyEvent({ ...navigation, commandRevision: 2 }, 'current', 2, date, logs, 2), true);
});
