import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHourRail, buildHourRailRows } from '../src/lib/hours.ts';
const food = (id, time = '08:00') => ({ id, name: id, time, portion: '100g', calories: 120, protein: 5, carbs: 15, fat: 4 });

test('empty days preserve every tappable hour and reuse empty row identities', () => {
  const first = buildHourRailRows([]);
  const second = buildHourRailRows([]);
  assert.equal(first.length, 18);
  assert.equal(first[0].hour, '05:00');
  assert.equal(first.at(-1).hour, '22:00');
  assert(first.every((row, index) => row.kind === 'empty' && row === second[index]));
});

test('one hundred foods in one hour are separate virtual cells with an exact group action', () => {
  const foods = Array.from({ length: 100 }, (_, i) => food(`food-${i}`));
  const before = structuredClone(foods);
  const rows = buildHourRailRows(foods);
  const summaries = rows.filter((row) => row.kind === 'summary');
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0].ids, foods.map((item) => item.id));
  assert.equal(summaries[0].totals.calories, 12000);
  assert.equal(rows.filter((row) => row.kind === 'food').length, 100);
  assert(rows.filter((row) => row.kind === 'food').every((row) => !row.showHour));
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.deepEqual(foods, before);
});

test('singletons own an hour node, out-of-range foods remain visible and order is preserved', () => {
  const foods = [food('early', '02:00'), food('a', '08:05'), food('b', '08:20'), food('late', '23:00')];
  const rows = buildHourRailRows(foods);
  const cells = rows.filter((row) => row.kind === 'food');
  assert.equal(rows[0].hour, '02:00');
  assert.equal(rows.at(-1).hour, '23:00');
  assert.deepEqual(cells.map((row) => row.food.id), ['early', 'a', 'b', 'late']);
  assert.deepEqual(cells.map((row) => row.showHour), [true, false, false, true]);
});

test('hour grouping preserves rounding and never drops dense groups', () => {
  const foods = [food('a', '08:30'), food('b', '08:31'), ...Array.from({ length: 1000 }, (_, i) => food(`dense-${i}`, '09:00'))];
  const rail = buildHourRail(foods);
  assert.equal(rail.find((slot) => slot.hour === '08:00').foods.length, 1);
  assert.equal(rail.find((slot) => slot.hour === '09:00').foods.length, 1001);
});
