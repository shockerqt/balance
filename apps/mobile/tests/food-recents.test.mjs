import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEnteredQuantity, frequentTemplates, lastLoggedPortions, personalTemplates, recentTemplates, searchTemplates, suggestedTemplatesForTime } from '../src/lib/food-recents.ts';
import { epochForChileDateTime, shiftDateId } from '../src/lib/dates.ts';

const DAY = 864e5, now = 100 * DAY;
const t = (id, name, extra = {}) => ({ id, name, isOfficial: false, updatedAt: 1, _deleted: false, details: {}, ...extra });
const log = (templateId, daysAgo, extra = {}) => ({ id: `${templateId}-${daysAgo}`, templateId, consumedAt: now - daysAgo * DAY, _deleted: false, ...extra });
const templates = [t('a', 'Avena'), t('b', 'Plátano', { isOfficial: true }), t('c', 'Café'), t('gone', 'Borrado', { _deleted: true })];

test('recents order by last use inside 30 days and skip deleted logs and templates', () => {
  const logs = [log('a', 5), log('b', 1), log('c', 40), log('a', 2, { _deleted: true }), log('gone', 0), log(null, 0)];
  assert.deepEqual(recentTemplates(logs, templates, now).map(x => x.id), ['b', 'a']);
});

test('frequent orders by count inside 90 days, ties by latest use', () => {
  const logs = [log('a', 80), log('a', 70), log('c', 60), log('c', 3), log('b', 1), log('b', 95), log('b', 120)];
  assert.deepEqual(frequentTemplates(logs, templates, now).map(x => x.id), ['c', 'a', 'b']);
});

test('my foods are the personal templates by name', () => {
  assert.deepEqual(personalTemplates(templates).map(x => x.id), ['a', 'c']);
});

test('search ignores accents and case and puts prefix matches first', () => {
  assert.deepEqual(searchTemplates([t('1', 'Leche de avena'), t('2', 'Avena'), t('3', 'Plátano')], 'AVÉNA').map(x => x.id), ['2', '1']);
  assert.deepEqual(searchTemplates([t('3', 'Plátano')], 'platano').map(x => x.id), ['3']);
  assert.equal(searchTemplates([t('x', 'Borrado', { _deleted: true })], '').length, 0);
});

test('search matches brand accent/case-insensitively and ranks name matches ahead of brand-only matches', () => {
  const list = [
    t('brand-only', 'Yogur griego', { details: { brand: 'Sopróle' } }),
    t('name-mid', 'Leche Soprole descremada', { details: { brand: 'Colun' } }),
    t('name-start', 'Soprole clásico'),
  ];
  assert.deepEqual(
    searchTemplates(list, 'soprole').map(x => x.id),
    ['name-start', 'name-mid', 'brand-only']
  );
});

/* Sugeridos por hora: reloj fijo al 2026-07-15 12:00 de Chile. */
const TODAY = '2026-07-15', NOW = epochForChileDateTime(TODAY, '12:00');
const at = (templateId, daysAgo, time, extra = {}) => ({ id: `${templateId}-${daysAgo}-${time}`, templateId, _deleted: false, updatedAt: 1,
  consumedAt: epochForChileDateTime(shiftDateId(TODAY, -daysAgo), time), ...extra });
const ids = list => list.map(x => x.id);
const suggested = (logs, list, time) => ids(suggestedTemplatesForTime(logs, list, time, NOW));
const named = (...names) => names.map(id => t(id, id));

test('suggestions use circular hour distance across midnight and re-rank when the target time changes', () => {
  const list = named('a', 'b', 'c');
  const logs = [at('a', 1, '23:20'), at('b', 1, '02:00'), at('c', 1, '03:00')];
  // 23 -> a (D=0); b and c are 3 and 4 hours away and only come back as recents, newest first.
  assert.deepEqual(suggested(logs, list, '23:40'), ['a', 'c', 'b']);
  // 00 -> a is one hour away (23 vs 0), b two hours, c three: b outranks the newer c.
  assert.deepEqual(suggested(logs, list, '00:10'), ['a', 'b', 'c']);
  assert.deepEqual(suggested(logs, list, '02:00'), ['b', 'c', 'a']);
});

test('suggestions decay by Chilean calendar day inside 90 days', () => {
  const list = named('x', 'y', 'z', 'w');
  const logs = [at('x', 1, '08:00'), at('y', 80, '08:00'), at('y', 80, '08:30'), at('z', 10, '08:00'), at('z', 10, '08:10'), at('w', 95, '08:00')];
  // z: 2·0.98^10 ≈ 1.63, x: 0.98, y: 2·0.98^80 ≈ 0.40; w is outside the window.
  assert.deepEqual(suggested(logs, list, '08:00'), ['z', 'x', 'y']);
});

test('suggestions weight 1/0.5/0.2 and break ties by latest use, then id', () => {
  const list = named('m', 'n', 'p', 'q', 'r', 's');
  const logs = [at('p', 1, '11:00'), at('q', 1, '13:00'), at('s', 2, '12:00'), at('r', 2, '12:00'),
    at('m', 3, '11:00'), at('m', 3, '13:00'), at('n', 3, '12:00')];
  // r/s: 0.98² · 1, equal times -> id. q/p: 0.98 · 0.5, q is newer.
  // m: 2 · 0.98³ · 0.5 equals n: 0.98³ · 1; m was logged later that day.
  assert.deepEqual(suggested(logs, list, '12:00'), ['r', 's', 'm', 'n', 'q', 'p']);
  // m: D=1 weighs 0.5 and its D=3 log adds nothing; n at D=2 weighs only 0.2.
  assert.deepEqual(suggested([at('m', 1, '11:00'), at('m', 1, '15:00'), at('n', 1, '10:00')], list, '12:00'), ['m', 'n']);
});

test('suggestions skip deleted logs and templates, keep future logs and fall back to recents for invalid times', () => {
  const list = [...named('a', 'b', 'c'), t('gone', 'gone', { _deleted: true })];
  const logs = [at('a', 1, '12:00', { _deleted: true }), at('a', 40, '20:00'), at('gone', 1, '12:00'), at(null, 1, '12:00'),
    at('b', -1, '12:00'), at('c', 2, '20:00')];
  // b is tomorrow: age clamps to 0. a only has an old evening log (not recent); c is recent.
  assert.deepEqual(suggested(logs, list, '12:00'), ['b', 'c']);
  assert.deepEqual(suggested(logs, list, '20:00'), ['c', 'a', 'b']);
  assert.deepEqual(suggested(logs, list, '25:00'), ids(recentTemplates(logs, list, NOW)));
  assert.deepEqual(suggested(logs, list, ''), ['b', 'c']);
  assert.deepEqual(suggested([], list, '12:00'), []);
});

test('suggestion cache recomputes when now or the window changes for the same logs', () => {
  const list = named('a');
  const logs = [at('a', 50, '12:00')];
  assert.deepEqual(ids(suggestedTemplatesForTime(logs, list, '12:00', NOW, 90)), ['a']);
  assert.deepEqual(ids(suggestedTemplatesForTime(logs, list, '12:00', NOW, 30)), []);
  assert.deepEqual(ids(suggestedTemplatesForTime(logs, list, '12:00', NOW + 60 * DAY, 90)), []);
  assert.deepEqual(ids(suggestedTemplatesForTime(logs, list, '12:00', NOW, 90)), ['a']);
});

const food = (id, unit, portions = []) => t(id, id, { details: { canonicalUnit: unit, portions } });
const used = (templateId, consumedAt, enteredQuantity, portionSnapshot, extra = {}) => ({ id: `${templateId}-${consumedAt}-${extra.updatedAt ?? 1}`, templateId, consumedAt,
  updatedAt: 1, _deleted: false, nutritionSnapshot: { canonicalUnit: extra.unit ?? 'g' }, entry: { enteredQuantity, ...(portionSnapshot ? { portionSnapshot } : {}) }, ...extra });
const snap = portionId => ({ ...(portionId ? { portionId } : {}), name: 'porción', portionQuantity: 1, canonicalQuantity: 40 });

test('last logged portions resolve the newest log against the live template', () => {
  const cup = { id: 'cup', name: 'taza', portionQuantity: 1, canonicalQuantity: 80 }, bowl = { id: 'bowl', name: 'bowl', portionQuantity: 1, canonicalQuantity: 40 };
  const list = [food('oat', 'g', [cup, bowl]), food('milk', 'ml'), food('juice', 'ml'), food('rice', 'g', [cup]), food('legacy', 'g', [cup]),
    food('tie', 'g', [cup]), food('zero', 'g'), food('fresh', 'g'), { ...food('gone', 'g', [cup]), _deleted: true }];
  const map = lastLoggedPortions([
    used('oat', 10, 2, snap('cup')), used('oat', 20, 1.5, snap('bowl')),
    used('milk', 5, 250, null, { unit: 'ml' }),
    used('juice', 5, 300, null, { unit: 'g' }),
    used('rice', 5, 3, snap('removed')),
    used('legacy', 5, 2, snap(undefined)),
    used('tie', 7, 2, snap('cup'), { updatedAt: 1 }), used('tie', 7, 3, snap('cup'), { updatedAt: 2 }),
    used('zero', 5, 0, null),
    used('fresh', 1, 120, null), used('fresh', 9, 999, null, { _deleted: true }),
    used('gone', 5, 2, snap('cup')), used('missing', 5, 2, null), used(null, 5, 2, null),
  ], list);
  assert.deepEqual(map.get('oat'), { portionId: 'bowl', quantity: '1,5' });
  assert.deepEqual(map.get('milk'), { portionId: '', quantity: '250' });
  // Canonical log whose unit no longer matches the template: default 100 canonical.
  assert.deepEqual(map.get('juice'), { portionId: '', quantity: '100' });
  assert.deepEqual(map.get('rice'), { portionId: 'cup', quantity: '1' });
  assert.deepEqual(map.get('legacy'), { portionId: 'cup', quantity: '1' });
  assert.deepEqual(map.get('tie'), { portionId: 'cup', quantity: '3' });
  assert.deepEqual(map.get('zero'), { portionId: '', quantity: '100' });
  assert.deepEqual(map.get('fresh'), { portionId: '', quantity: '120' });
  assert.equal(map.has('gone'), false); assert.equal(map.has('missing'), false); assert.equal(map.size, 8);
});

test('entered quantities format with up to two decimals and a decimal comma', () => {
  assert.equal(formatEnteredQuantity(1.5), '1,5');
  assert.equal(formatEnteredQuantity(2), '2');
  assert.equal(formatEnteredQuantity(250), '250');
  assert.equal(formatEnteredQuantity(1 / 3), '0,33');
  for (const value of [0, -1, NaN, Infinity, 0.001, '2', null, undefined]) assert.equal(formatEnteredQuantity(value), null);
});
