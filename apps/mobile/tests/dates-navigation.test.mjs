import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDateWindow,
  displayDateFor,
  generateWeeksWindow,
  getMondayDateId,
  parseDateId,
  shiftDateId,
  toDateId,
} from '../src/lib/dates.ts';

test('parseDateId and shiftDateId shift days deterministically across month and year boundaries', () => {
  assert.equal(shiftDateId('2026-08-19', 1), '2026-08-20');
  assert.equal(shiftDateId('2026-08-19', -1), '2026-08-18');
  assert.equal(shiftDateId('2026-08-31', 1), '2026-09-01');
  assert.equal(shiftDateId('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDateId('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateId('2027-01-01', -1), '2026-12-31');
});

test('getMondayDateId finds the Monday for any day of the week', () => {
  // 2026-08-17 is Monday, 2026-08-19 is Wednesday, 2026-08-23 is Sunday
  assert.equal(getMondayDateId('2026-08-17'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-18'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-19'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-20'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-21'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-22'), '2026-08-17');
  assert.equal(getMondayDateId('2026-08-23'), '2026-08-17');
});

test('buildDateWindow produces continuous sequential days aligned to Monday', () => {
  const window = buildDateWindow('2026-08-19', 1, 1);
  // 1 week before, current week, 1 week after = 3 weeks = 21 days
  assert.equal(window.length, 21);
  assert.equal(window[0], '2026-08-10'); // Monday of previous week
  assert.equal(window[7], '2026-08-17'); // Monday of current week
  assert.equal(window[9], '2026-08-19'); // Wednesday
  assert.equal(window[20], '2026-08-30'); // Sunday of next week

  // Every single day is strictly 1 day after the previous
  for (let i = 1; i < window.length; i++) {
    assert.equal(shiftDateId(window[i - 1], 1), window[i]);
  }
});

test('generateWeeksWindow generates 5 distinct 7-day groups with correct day names and numbers', () => {
  const weeks = generateWeeksWindow('2026-08-19', 2, 2, '2026-08-19');
  assert.equal(weeks.length, 5);

  // Center week (index 2) must contain 2026-08-19
  const centerWeek = weeks[2];
  assert.equal(centerWeek.days.length, 7);
  assert.equal(centerWeek.days[0].dateId, '2026-08-17'); // Monday
  assert.equal(centerWeek.days[0].dayName, 'L');
  assert.equal(centerWeek.days[2].dateId, '2026-08-19'); // Wednesday
  assert.equal(centerWeek.days[2].dayName, 'M');
  assert.equal(centerWeek.days[2].dayNumber, 19);
  assert.equal(centerWeek.days[2].isToday, true);
  assert.equal(centerWeek.days[0].isToday, false);

  // Previous week (index 1)
  assert.equal(weeks[1].days[0].dateId, '2026-08-10');
  // Next week (index 3)
  assert.equal(weeks[3].days[0].dateId, '2026-08-24');
});

test('week navigation preserves day-of-week offset when switching weeks', () => {
  const weeks = generateWeeksWindow('2026-08-19', 2, 2, '2026-08-19');
  // User is on Wednesday (2026-08-19)
  const base = parseDateId('2026-08-19');
  const dayOfWeekIndex = (base.getUTCDay() + 6) % 7; // Wednesday = 2 (0-indexed: L=0, M=1, M=2)
  assert.equal(dayOfWeekIndex, 2);

  // Next week (index 3)
  const nextWeek = weeks[3];
  const matchingDay = nextWeek.days[dayOfWeekIndex];
  assert.equal(matchingDay.dateId, '2026-08-26');
  assert.equal(matchingDay.dayName, 'M');
});

test('displayDateFor formats human-readable Chilean display date', () => {
  const formatted = displayDateFor('2026-08-19');
  assert.match(formatted, /Miércoles 19 de Agosto/);
});
