import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDateWindow,
  dateIdToEpochDay,
  displayDateFor,
  epochDayToDateId,
  generateWeeksWindow,
  getMondayDateId,
  parseDateId,
  shiftDateId,
  toDateId,
  todayId,
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

/* Las funciones de ventana ya no pasan por Intl: mueven dateIds con aritmetica
   sobre mediodia UTC. Estas pruebas fijan esa equivalencia, que es la premisa
   del atajo, y verifican que el camino que si necesita zona horaria la sigue
   aplicando. */

test('el atajo aritmetico coincide con el camino por zona horaria durante un ano completo', () => {
  // Cubre los dos cambios de hora de Chile: abril y septiembre.
  let dateId = '2026-01-01';
  for (let i = 0; i < 400; i++) {
    const [y, m, d] = dateId.split('-').map(Number);
    const viaTimeZone = toDateId(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
    assert.equal(dateId, viaTimeZone, `desfase en ${dateId}`);
    dateId = shiftDateId(dateId, 1);
  }
});

test('buildDateWindow y generateWeeksWindow entregan dias continuos alrededor del cambio de hora', () => {
  // 2026-09-06 es el primer domingo de septiembre: Chile adelanta el reloj.
  const window = buildDateWindow('2026-09-06', 2, 2);
  assert.equal(window.length, 35);
  for (let i = 1; i < window.length; i++) {
    assert.equal(shiftDateId(window[i - 1], 1), window[i]);
  }
  assert.ok(window.includes('2026-09-06'));

  const weeks = generateWeeksWindow('2026-04-05', 2, 2, '2026-04-05');
  const flat = weeks.flatMap((week) => week.days.map((day) => day.dateId));
  assert.equal(flat.length, 35);
  for (let i = 1; i < flat.length; i++) {
    assert.equal(shiftDateId(flat[i - 1], 1), flat[i]);
  }
  assert.ok(flat.includes('2026-04-05'));
});

test('toDateId sigue resolviendo el dia calendario chileno, no el del dispositivo', () => {
  // 2026-08-20T02:30:00Z son las 22:30 del 19 de agosto en Chile (UTC-4).
  assert.equal(toDateId(new Date('2026-08-20T02:30:00Z')), '2026-08-19');
  // 2026-08-20T04:30:00Z ya es el 20 de agosto en Chile.
  assert.equal(toDateId(new Date('2026-08-20T04:30:00Z')), '2026-08-20');
});

test('todayId memoizado devuelve siempre el mismo dateId dentro del mismo minuto', () => {
  const first = todayId();
  assert.match(first, /^\d{4}-\d{2}-\d{2}$/);
  for (let i = 0; i < 100; i++) {
    assert.equal(todayId(), first);
  }
});

/* El dia absoluto es la unidad que comparten el hilo de JS y el de UI: la
   cabecera interpola entre enteros mientras el pager avanza. Si dejara de ser
   una biyeccion con el dateId, el resaltado apuntaria al dia equivocado. */

test('dateIdToEpochDay avanza de uno en uno y es reversible', () => {
  let dateId = '2026-01-01';
  let expected = dateIdToEpochDay(dateId);
  for (let i = 0; i < 400; i++) {
    const epochDay = dateIdToEpochDay(dateId);
    assert.equal(epochDay, expected, `desfase en ${dateId}`);
    assert.equal(epochDayToDateId(epochDay), dateId);
    dateId = shiftDateId(dateId, 1);
    expected += 1;
  }
});

test('dateIdToEpochDay cruza mes, ano y los cambios de hora de Chile sin saltos', () => {
  assert.equal(dateIdToEpochDay('2026-09-01') - dateIdToEpochDay('2026-08-31'), 1);
  assert.equal(dateIdToEpochDay('2027-01-01') - dateIdToEpochDay('2026-12-31'), 1);
  // Chile adelanta el reloj el primer domingo de septiembre y lo atrasa en abril.
  assert.equal(dateIdToEpochDay('2026-09-07') - dateIdToEpochDay('2026-09-06'), 1);
  assert.equal(dateIdToEpochDay('2026-04-06') - dateIdToEpochDay('2026-04-05'), 1);
  // Una semana son siete dias, tambien atravesando el cambio de hora.
  assert.equal(dateIdToEpochDay('2026-09-13') - dateIdToEpochDay('2026-09-06'), 7);
});

test('epochDayToDateId reconstruye el dateId desde un entero suelto', () => {
  assert.equal(epochDayToDateId(dateIdToEpochDay('2026-08-19')), '2026-08-19');
  assert.equal(epochDayToDateId(dateIdToEpochDay('1970-01-01')), '1970-01-01');
  assert.equal(epochDayToDateId(dateIdToEpochDay('1969-12-31')), '1969-12-31');
});

test('generateWeeksWindow entrega el dia absoluto de cada pildora', () => {
  const weeks = generateWeeksWindow('2026-08-19', 1, 1, '2026-08-19');
  const flat = weeks.flatMap((week) => week.days);
  for (const day of flat) {
    assert.equal(day.epochDay, dateIdToEpochDay(day.dateId), `desfase en ${day.dateId}`);
  }
  // Contiguos: la animacion de la banda depende de que la distancia sea el dia.
  for (let i = 1; i < flat.length; i++) {
    assert.equal(flat[i].epochDay - flat[i - 1].epochDay, 1);
  }
});
