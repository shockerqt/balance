import test from 'node:test';
import assert from 'node:assert/strict';
import { frequentTemplates, personalTemplates, recentTemplates, searchTemplates } from '../src/lib/food-recents.ts';

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
