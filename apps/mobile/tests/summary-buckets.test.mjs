import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSummaryDays, rangeSummary, summaryBuckets } from '../src/lib/summary-buckets.ts';
import { createInterfaceDaysProjector } from '../src/components/meal/native/interface-contract.ts';

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

const makeFood = (id, calories, protein, carbs, fat) => ({
  id,
  name: `Food ${id}`,
  portion: '100 g',
  calories,
  protein,
  carbs,
  fat,
  time: '12:00',
});

const makeLog = (dateId, foods) => ({
  dateId,
  displayDate: dateId,
  targetCalories: 2000,
  targetProtein: 150,
  targetCarbs: 200,
  targetFat: 70,
  targetFiber: 30,
  foods,
});

const makeWeight = (id, weightGrams) => ({
  id,
  weightGrams,
  updatedAt: 1,
  _deleted: false,
});

test('projectSummaryDays projects recorded days, weight-only days, and excludes out-of-window dates', () => {
  const dayLogs = {
    '2025-01-01': makeLog('2025-01-01', [makeFood('old', 2500, 120, 250, 80)]),
    '2026-08-14': makeLog('2026-08-14', [makeFood('before90', 1900, 90, 200, 60)]),
    '2026-08-15': makeLog('2026-08-15', [makeFood('first90', 1500, 80, 150, 50)]),
    '2026-11-10': makeLog('2026-11-10', []),
    '2026-11-12': makeLog('2026-11-12', [
      makeFood('f1', 600, 40, 50, 20),
      makeFood('f2', 740, 35, 90, 25),
    ]),
    '2026-11-13': makeLog('2026-11-13', [makeFood('future', 1000, 50, 100, 30)]),
    'not-a-date': makeLog('not-a-date', [makeFood('bad', 999, 10, 10, 10)]),
  };
  const weightsByDate = {
    '2025-01-01': makeWeight('2025-01-01', 82000),
    '2026-08-14': makeWeight('2026-08-14', 80500),
    '2026-11-07': makeWeight('2026-11-07', 79000),
    '2026-11-12': makeWeight('2026-11-12', 78400),
    '2026-11-13': makeWeight('2026-11-13', 78100),
  };

  const projected = projectSummaryDays(dayLogs, weightsByDate, '2026-11-12', 90);

  assert.deepEqual(Object.keys(projected).sort(), [
    '2026-08-15',
    '2026-11-07',
    '2026-11-10',
    '2026-11-12',
  ]);
  assert.deepEqual(projected['2026-08-15'], {
    recorded: true,
    calories: 1500,
    protein: 80,
    carbs: 150,
    fat: 50,
    weightKg: null,
  });
  assert.deepEqual(projected['2026-11-07'], {
    recorded: false,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    weightKg: 79,
  });
  assert.deepEqual(projected['2026-11-10'], {
    recorded: false,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    weightKg: null,
  });
  assert.deepEqual(projected['2026-11-12'], {
    recorded: true,
    calories: 1340,
    protein: 75,
    carbs: 140,
    fat: 45,
    weightKg: 78.4,
  });
});

test('projectSummaryDays matches createInterfaceDaysProjector for all in-window dates', () => {
  const dayLogs = {
    '2026-01-10': makeLog('2026-01-10', [makeFood('hist', 2100, 110, 220, 70)]),
    '2026-08-15': makeLog('2026-08-15', [makeFood('a1', 420.5, 30.25, 45.5, 12.75)]),
    '2026-11-06': makeLog('2026-11-06', [makeFood('b1', 1200, 80, 120, 40), makeFood('b2', 800, 50, 90, 25)]),
    '2026-11-08': makeLog('2026-11-08', []),
    '2026-11-12': makeLog('2026-11-12', [makeFood('c1', 1340, 95, 130, 42)]),
  };
  const weightsByDate = {
    '2026-01-10': makeWeight('2026-01-10', 81500),
    '2026-11-07': makeWeight('2026-11-07', 79000),
    '2026-11-12': makeWeight('2026-11-12', 78400),
  };

  const fullProjector = createInterfaceDaysProjector();
  const fullProjected = fullProjector(dayLogs, weightsByDate, []);
  const summaryProjected = projectSummaryDays(dayLogs, weightsByDate, '2026-11-12', 90);

  for (const [date, summaryDay] of Object.entries(summaryProjected)) {
    const fullDay = fullProjected[date];
    assert.ok(fullDay, `expected ${date} in full projection`);
    assert.deepEqual(summaryDay, {
      recorded: fullDay.recorded,
      calories: fullDay.totals.calories,
      protein: fullDay.totals.protein,
      carbs: fullDay.totals.carbs,
      fat: fullDay.totals.fat,
      weightKg: fullDay.weightKg,
    });
  }
  assert.equal('2026-01-10' in summaryProjected, false);
});
