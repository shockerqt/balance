import assert from 'node:assert/strict';
import test from 'node:test';
import { isMealLogDoc, parsePushRejections } from '../src/services/sync/types.ts';

const base = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  templateId: null,
  nameSnapshot: 'Historical source',
  nutritionSnapshot: {
    schemaVersion: 2, canonicalUnit: 'g',
    nutritionPer100: { calories: 123.125, protein: 7.25, carbs: 11.5, fat: 3.75, fiber: null, sodiumMg: 0 },
  },
  canonicalQuantity: 75,
  entry: { enteredQuantity: 75 },
  consumedAt: 1_786_233_600_000,
  updatedAt: 1_786_233_600_001,
  _deleted: false,
});
const source = { id: '11111111-1111-4111-8111-111111111111', updatedAt: 1_786_233_600_000 };

test('historical documents remain valid and copy intent preserves unknown/null/zero nutrition', () => {
  assert.equal(isMealLogDoc(base()), true);
  assert.equal(isMealLogDoc({ ...base(), copySource: source }), true);
  assert.equal(isMealLogDoc({ ...base(), copySource: source, _deleted: true }), true);
  const document = base();
  delete document.nutritionSnapshot.nutritionPer100.fiber;
  assert.equal(isMealLogDoc({ ...document, copySource: source }), true);
});

for (const [label, copySource] of [
  ['null', null], ['empty', {}], ['wrong id type', { ...source, id: 1 }],
  ['empty id', { ...source, id: '' }], ['whitespace id', { ...source, id: ' source ' }],
  ['zero revision', { ...source, updatedAt: 0 }], ['negative revision', { ...source, updatedAt: -1 }],
  ['fractional revision', { ...source, updatedAt: 1.5 }], ['nonfinite revision', { ...source, updatedAt: Infinity }],
  ['unsafe revision', { ...source, updatedAt: Number.MAX_SAFE_INTEGER + 1 }],
  ['extra reference field', { ...source, account: 'other' }],
]) {
  test(`copy intent rejects ${label}`, () => {
    assert.equal(isMealLogDoc({ ...base(), copySource }), false);
  });
}

test('copies cannot retain the unique MacroFactor import-row identity', () => {
  const provenance = { provider: 'macrofactor', externalId: 'original-row' };
  assert.equal(isMealLogDoc({ ...base(), provenance }), true);
  assert.equal(isMealLogDoc({ ...base(), copySource: source, provenance }), false);
});

test('copy row rejections preserve the submitted row index and stable protocol code', () => {
  const rejection = { index: 2, code: 'copy_source_unavailable', message: 'The copy source is no longer available' };
  assert.deepEqual(parsePushRejections([rejection], 4), [rejection]);
});
