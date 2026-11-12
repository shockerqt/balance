import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeSummary, summaryBuckets } from '../src/lib/summary-buckets.ts';

const day = (calories, extra = {}) => ({ recorded: true, calories, protein: 10, carbs: 20, fat: 5, weightKg: null, ...extra });
const days = {
  '2026-11-06': day(2000), '2026-11-07': { recorded: false, calories: 0, protein: 0, carbs: 0, fat: 0, weightKg: 79 },
  '2026-11-09': day(1800, { weightKg: 78.7 }), '2026-11-12': day(1340, { weightKg: 78.4 }),
};

test('7 days give one bar per day; unrecorded days are empty, not zero', () => {
  const b = summaryBuckets(days, '2026-11-12', 7);
  assert.equal(b.length, 7); assert.equal(b[0].start, '2026-11-06'); assert.equal(b[6].end, '2026-11-12');
  assert.equal(b[0].average, 2000); assert.equal(b[1].average, null); assert.equal(b[1].latestRecorded, null);
  assert.equal(b[6].latestRecorded, '2026-11-12');
});

test('30 and 90 days bucket the whole range contiguously and average recorded days only', () => {
  for (const [period, count] of [[30, 10], [90, 12]]) {
    const b = summaryBuckets(days, '2026-11-12', period);
    assert.equal(b.length, count);
    assert.equal(b.at(-1).end, '2026-11-12');
    const total = b.reduce((n, x) => n + (Date.parse(x.end) - Date.parse(x.start)) / 864e5 + 1, 0);
    assert.equal(total, period);
  }
  const b30 = summaryBuckets(days, '2026-11-12', 30);
  const last = b30.at(-1);
  assert.deepEqual([last.start, last.end, last.average, last.latestRecorded], ['2026-11-10', '2026-11-12', 1340, '2026-11-12']);
  const mid = b30.find(x => x.start <= '2026-11-06' && x.end >= '2026-11-06');
  assert.equal(mid.recordedDays, 1);
});

test('range averages exclude unrecorded days and weights come in date order', () => {
  const r = rangeSummary(days, '2026-11-12', 7);
  assert.equal(r.recordedDays, 3); assert.equal(r.calories, (2000 + 1800 + 1340) / 3); assert.equal(r.protein, 10);
  assert.deepEqual(r.weights.map(w => w.kg), [79, 78.7, 78.4]);
  assert.equal(rangeSummary({}, '2026-11-12', 7).calories, null);
});
