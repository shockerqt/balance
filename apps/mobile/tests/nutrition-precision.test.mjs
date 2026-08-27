import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCalories, formatEditableNutrition, formatMacroGrams, sumNutrition } from '../src/lib/nutrition.ts';
import { scaleMacros } from '../src/lib/portion.ts';
import { isNutrition } from '../src/services/sync/types.ts';

test('formats nutrition for Chilean display without float artifacts', () => {
  assert.equal(formatCalories(104.6), '105');
  assert.equal(formatMacroGrams(12.219999999999), '12,2');
  assert.equal(formatMacroGrams(12), '12');
  assert.equal(formatEditableNutrition(12.219999999999), '12,22');
});

test('keeps raw scaling precision until the presentation boundary', () => {
  const scaled = scaleMacros(
    {
      id: 'food-1',
      name: 'Alimento',
      portion: '100g',
      calories: 123.45,
      protein: 8.15,
      carbs: 12.22,
      fat: 4.075,
      typicalTime: '12:00'
    },
    150
  );

  assert.equal(scaled.calories, 185.175);
  assert.equal(scaled.protein, 12.225000000000001);
  assert.equal(formatCalories(scaled.calories), '185');
  assert.equal(formatMacroGrams(scaled.protein), '12,2');
});

test('aggregates raw values and formats only the resulting total', () => {
  const totals = sumNutrition([
    { calories: 100.1, protein: 0.1, carbs: 1.005, fat: 12.219999999999 },
    { calories: 100.2, protein: 0.2, carbs: 2.005, fat: 0.1, fiber: 0 }
  ]);

  assert.equal(totals.protein, 0.30000000000000004);
  assert.equal(formatCalories(totals.calories), '200');
  assert.equal(formatMacroGrams(totals.protein), '0,3');
  assert.equal(formatMacroGrams(totals.fat), '12,3');
  assert.equal(formatMacroGrams(totals.fiber), '0');
});

test('sync nutrition round-trip keeps unknown fiber distinct from explicit zero', () => {
  const unknownFiber = {
    calories: 100,
    protein: 10,
    carbs: 20,
    fat: 5
  };
  assert.equal(isNutrition(unknownFiber), true);
  const unknownRoundTrip = JSON.parse(JSON.stringify(unknownFiber));
  assert.equal(isNutrition(unknownRoundTrip), true);
  assert.equal('fiber' in unknownRoundTrip, false);
  assert.equal(unknownRoundTrip.fiber, undefined);

  const zeroFiber = { ...unknownFiber, fiber: 0 };
  assert.equal(isNutrition(zeroFiber), true);
  const zeroRoundTrip = JSON.parse(JSON.stringify(zeroFiber));
  assert.equal(isNutrition(zeroRoundTrip), true);
  assert.equal('fiber' in zeroRoundTrip, true);
  assert.equal(zeroRoundTrip.fiber, 0);

  assert.equal(isNutrition({ ...unknownFiber, fiber: -1 }), false);
  assert.equal(isNutrition({ ...unknownFiber, fiber: Number.NaN }), false);
});
