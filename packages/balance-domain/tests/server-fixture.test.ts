import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalQuantityForPortion, scaleNutrition } from '../src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/canonical-spoon.json', import.meta.url), 'utf8'));

test('matches the portable Rust canonical spoon example without rounding', () => {
  const { document, expectedNutrition } = fixture;
  assert.equal(canonicalQuantityForPortion(document.entry.enteredQuantity, document.entry.portionSnapshot), 6);
  const scaled = scaleNutrition(document.nutritionSnapshot.nutritionPer100, document.canonicalQuantity / 100);
  for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const) {
    const expected = expectedNutrition[key];
    assert.ok(Math.abs(scaled[key]! - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-8));
  }
  assert.equal(scaled.extendedNutrition?.vitaminCMg, expectedNutrition.extendedNutrition.vitaminCMg);
});
