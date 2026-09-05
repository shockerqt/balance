import assert from 'node:assert/strict';
import test from 'node:test';
import { utils, write } from 'xlsx';
import {
  MACRO_FACTOR_HEADERS,
  buildMacroFactorDocumentPlan,
  parseMacroFactorTable,
  parseMacroFactorWorkbook,
} from '../src/services/import/macro-factor.ts';
import { sha256Hex } from '../src/services/import/sha256.ts';

function sourceRow(overrides = {}) {
  const values = Object.fromEntries(MACRO_FACTOR_HEADERS.map((header) => [header, '']));
  Object.assign(values, {
    Date: '2024-09-09',
    Time: '7:00',
    'Food Name': 'Almonds, dry roasted, unsalted',
    'Serving Size': 'g',
    'Serving Qty': 40,
    'Serving Weight (g)': 1,
    'Calories (kcal)': 239,
    'Fat (g)': 21,
    'Carbs (g)': 8,
    'Protein (g)': 8,
    'Fiber (g)': 4.4,
    'Sodium (mg)': 1.2,
    'B2, Riboflavin (mg)': 0.5,
    'Omega-6 (g)': 5.2,
    'Water (g)': 1,
    ...overrides,
  });
  return MACRO_FACTOR_HEADERS.map((header) => values[header]);
}

test('parses all expected headers, BOM, H:MM, optional blanks, and extended nutrients', () => {
  const headers = [...MACRO_FACTOR_HEADERS];
  headers[0] = `\uFEFF${headers[0]}`;
  const result = parseMacroFactorTable([headers, sourceRow()]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].time, '07:00');
  assert.equal(result.rows[0].foodName, 'Almonds, dry roasted, unsalted');
  assert.equal(result.rows[0].nutrition.riboflavinMg, undefined);
  assert.equal(result.rows[0].nutrition.extendedNutrition.riboflavinMg, 0.5);
  assert.equal(result.rows[0].nutrition.extendedNutrition.omega6G, 5.2);
  assert.equal(result.extendedNutrientCount, 3);
});

test('accepts observed first header value literal ï»¿"Date" without broadly unquoting other headers', () => {
  const headers = [...MACRO_FACTOR_HEADERS];
  headers[0] = 'ï»¿"Date"';
  const result = parseMacroFactorTable([headers, sourceRow()]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].date, '2024-09-09');

  const doubleMojibakeHeaders = [...MACRO_FACTOR_HEADERS];
  doubleMojibakeHeaders[0] = 'Ã¯Â»Â¿"Date"';
  const doubleResult = parseMacroFactorTable([doubleMojibakeHeaders, sourceRow()]);
  assert.equal(doubleResult.errors.length, 0);
  assert.equal(doubleResult.rows.length, 1);
  assert.equal(doubleResult.rows[0].date, '2024-09-09');

  const invalidHeaders = [...MACRO_FACTOR_HEADERS];
  invalidHeaders[2] = '"Food Name"';
  assert.throws(
    () => parseMacroFactorTable([invalidHeaders, sourceRow()]),
    /Faltan columnas de MacroFactor: Food Name/,
  );
});

test('parses an actual XLSX byte buffer from its first worksheet', () => {
  const headers = [...MACRO_FACTOR_HEADERS];
  headers[0] = 'ï»¿"Date"';
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([headers, sourceRow()]), 'Food');
  const bytes = write(workbook, { type: 'array', bookType: 'xlsx' });
  const result = parseMacroFactorWorkbook(bytes);
  assert.equal(result.rows.length, 1);
  assert.equal(result.dateStart, '2024-09-09');
  assert.equal(result.dateEnd, '2024-09-09');
});

test('parses an actual CSV byte buffer with mojibake header and quoted cells', () => {
  const headers = MACRO_FACTOR_HEADERS.map((h, i) => {
    if (i === 0) return '"ï»¿""Date"""';
    return h.includes(',') ? `"${h}"` : h;
  }).join(',');
  const row = sourceRow().map((val, i) => {
    const str = String(val);
    return str.includes(',') ? `"${str}"` : str;
  }).join(',');
  const csvText = `${headers}\n${row}\n`;
  const bytes = new TextEncoder().encode(csvText);
  const result = parseMacroFactorWorkbook(bytes);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].date, '2024-09-09');
  assert.equal(result.rows[0].foodName, 'Almonds, dry roasted, unsalted');
});

test('normalizes a multi-slice row to one serving and keeps exact historical totals', () => {
  const parsed = parseMacroFactorTable([
    MACRO_FACTOR_HEADERS,
    sourceRow({
      Time: '9:00',
      'Food Name': 'Pan Integral',
      'Serving Size': 'slices',
      'Serving Qty': 4,
      'Serving Weight (g)': 27.5,
      'Calories (kcal)': 282,
      'Fat (g)': 3,
      'Carbs (g)': 47,
      'Protein (g)': 14,
      'Fiber (g)': 6.6,
    }),
  ]);
  const plan = buildMacroFactorDocumentPlan(parsed.rows, [], [], 'guest', 1000);
  assert.equal(plan.templates.length, 1);
  assert.equal(plan.logs.length, 1);
  assert.equal(plan.templates[0].details.schemaVersion, 2);
  assert.equal(plan.templates[0].details.canonicalUnit, 'g');
  assert.deepEqual(plan.templates[0].details.portions[0], {
    id: 'macrofactor-serving', name: 'slices', portionQuantity: 1, canonicalQuantity: 27.5,
  });
  assert.ok(Math.abs(plan.templates[0].details.nutritionPer100.calories - (282 / 110 * 100)) < 1e-10);
  assert.equal(plan.logs[0].canonicalQuantity, 110);
  assert.equal(plan.logs[0].entry.enteredQuantity, 4);
  assert.equal(plan.logs[0].entry.portionSnapshot.canonicalQuantity, 27.5);
  assert.ok(Math.abs(plan.logs[0].nutritionSnapshot.nutritionPer100.calories * plan.logs[0].canonicalQuantity / 100 - 282) < 1e-10);
});

test('keeps Quick Add in history without creating a reusable template', () => {
  const parsed = parseMacroFactorTable([
    MACRO_FACTOR_HEADERS,
    sourceRow({
      Date: '2024-09-13',
      Time: '16:18',
      'Food Name': 'Quick Add',
      'Serving Size': 'serving',
      'Serving Qty': 1,
      'Serving Weight (g)': 100,
      'Calories (kcal)': 865,
      'Fat (g)': 25,
      'Carbs (g)': 120,
      'Protein (g)': 40,
    }),
  ]);
  const plan = buildMacroFactorDocumentPlan(parsed.rows, [], [], 'guest', 1000);
  assert.equal(parsed.quickAddCount, 1);
  assert.equal(plan.templates.length, 0);
  assert.equal(plan.logs.length, 1);
  assert.equal(plan.logs[0].templateId, null);
});

test('is idempotent, updates changed source rows, tombstones removals, and preserves manual data', () => {
  const parsed = parseMacroFactorTable([MACRO_FACTOR_HEADERS, sourceRow()]);
  const first = buildMacroFactorDocumentPlan(parsed.rows, [], [], 'guest', 1000);
  const manualLog = {
    ...first.logs[0],
    id: 'manual',
    provenance: undefined,
    updatedAt: 500,
  };
  const second = buildMacroFactorDocumentPlan(parsed.rows, first.templates, [...first.logs, manualLog], 'guest', 2000);
  assert.deepEqual(second.templateSummary, {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 1,
  });
  assert.deepEqual(second.logSummary, {
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 1,
  });
  assert.equal(
    second.logs.some((log) => log.id === 'manual'),
    false,
  );

  const changed = parseMacroFactorTable([
    MACRO_FACTOR_HEADERS,
    sourceRow({ 'Serving Qty': 20, 'Calories (kcal)': 120 }),
  ]);
  const updated = buildMacroFactorDocumentPlan(changed.rows, first.templates, first.logs, 'guest', 3000);
  assert.equal(updated.logSummary.updated, 1);
  assert.equal(updated.logs[0].id, first.logs[0].id);
  assert.equal(updated.logs[0].canonicalQuantity, 20);

  const removed = buildMacroFactorDocumentPlan([], first.templates, first.logs, 'guest', 4000);
  assert.equal(removed.templateSummary.deleted, 1);
  assert.equal(removed.logSummary.deleted, 1);
  assert.equal(removed.templates[0]._deleted, true);
  assert.equal(removed.logs[0]._deleted, true);
});

test('reports row errors and rejects incomplete schemas without silently importing', () => {
  const invalid = parseMacroFactorTable([MACRO_FACTOR_HEADERS, sourceRow({ Date: '2024-02-30', 'Serving Qty': 0 })]);
  assert.equal(invalid.rows.length, 0);
  assert.equal(invalid.errors.length, 1);
  assert.throws(() => parseMacroFactorTable([MACRO_FACTOR_HEADERS.slice(0, -1)]), /Faltan columnas de MacroFactor/);
});

test('plans a 10,000-row export without collisions or dropped records', () => {
  const table = [MACRO_FACTOR_HEADERS];
  for (let index = 0; index < 10_000; index += 1) {
    table.push(
      sourceRow({
        Time: `${index % 24}:${String(index % 60).padStart(2, '0')}`,
        'Food Name': `Fixture food ${index % 25}`,
      }),
    );
  }
  const parsed = parseMacroFactorTable(table);
  const plan = buildMacroFactorDocumentPlan(parsed.rows, [], [], 'user:fixture', 1000);
  assert.equal(parsed.errors.length, 0);
  assert.equal(plan.logs.length, 10_000);
  assert.equal(new Set(plan.logs.map((log) => log.id)).size, 10_000);
  assert.equal(plan.templates.length, 25);
});

test('computes a valid 64-character lowercase sha256 hex fingerprint synchronously', () => {
  // RFC 6234 known vectors
  assert.equal(
    sha256Hex(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const bytes = new TextEncoder().encode('MacroFactor-Export-Test-Payload');
  const hash = sha256Hex(bytes);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('repairs double UTF-8 mojibake accented characters in food names', () => {
  const table = [
    MACRO_FACTOR_HEADERS,
    sourceRow({
      'Date': '2026-08-16',
      'Time': '17:00',
      'Food Name': 'AtÃºn Desmenuzado en Agua',
      'Serving Size': 'portion',
      'Serving Qty': '1',
      'Serving Weight (g)': '104',
      'Calories (kcal)': '82',
      'Fat (g)': '1',
      'Carbs (g)': '1',
      'Protein (g)': '18',
    }),
  ];
  const parsed = parseMacroFactorTable(table);
  assert.equal(parsed.rows[0].foodName, 'Atún Desmenuzado en Agua');
});

