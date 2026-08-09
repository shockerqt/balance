import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatWeight,
  mergeWeightLogs,
  parseWeightInput,
  previousWeight,
  weightTrendDates,
} from '../src/services/weight/weight.ts';
import { isDateId } from '../src/services/sync/types.ts';

test('parses Chilean decimal input into exact 100 gram increments', () => {
  assert.equal(parseWeightInput('72,4'), 72_400);
  assert.equal(parseWeightInput('72.4'), 72_400);
  assert.equal(parseWeightInput('1,0'), 1_000);
  assert.equal(parseWeightInput('500,0'), 500_000);
  assert.equal(parseWeightInput('72,45'), null);
  assert.equal(parseWeightInput('0,9'), null);
  assert.equal(parseWeightInput('500,1'), null);
  assert.equal(formatWeight(72_400), '72,4');
});

test('merges daily measurements with last-write-wins tombstones', () => {
  const first = { id: '2026-08-08', weightGrams: 72_400, updatedAt: 10, _deleted: false };
  const stale = { ...first, weightGrams: 73_000, updatedAt: 9 };
  const removed = { ...first, updatedAt: 11, _deleted: true };
  assert.deepEqual(mergeWeightLogs([first], [stale]), [first]);
  assert.deepEqual(mergeWeightLogs([first], [removed]), [removed]);
});

test('builds a real seven-day window and finds the prior recorded day', () => {
  const dates = weightTrendDates('2026-08-09');
  assert.equal(dates.length, 7);
  assert.equal(dates[0].id, '2026-08-03');
  assert.equal(dates[6].id, '2026-08-09');
  const older = { id: '2026-08-02', weightGrams: 72_900, updatedAt: 1, _deleted: false };
  const prior = { id: '2026-08-08', weightGrams: 72_400, updatedAt: 2, _deleted: false };
  assert.equal(previousWeight({ [older.id]: older, [prior.id]: prior }, '2026-08-09'), prior);
});

test('accepts only real ISO calendar dates for daily identity', () => {
  assert.equal(isDateId('2026-08-09'), true);
  assert.equal(isDateId('2026-02-29'), false);
  assert.equal(isDateId('2026-13-01'), false);
  assert.equal(isDateId('09-08-2026'), false);
});
