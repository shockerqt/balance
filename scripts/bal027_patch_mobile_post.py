from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / 'apps/mobile/src/hooks/use-food-library-store.tsx'
FOOD_TEST = ROOT / 'apps/mobile/tests/food-library-documents.test.mjs'
MF_TEST = ROOT / 'apps/mobile/tests/macro-factor-import.test.mjs'

text = LIB.read_text()
text = text.replace('nutrition: { ...current.details.nutrition, ...editedDetails.nutrition },', 'nutritionPer100: { ...current.details.nutritionPer100, ...editedDetails.nutritionPer100 },')
LIB.write_text(text)

text = FOOD_TEST.read_text()
old = '''const details = {
  schemaVersion: 1,
  baseAmount: 100,
  unit: 'g',
  nutrition: {
    calories: 160,
    protein: 8,
    carbs: 24,
    fat: 4,
    fiber: 3,
    sodiumMg: 210,
    cholesterolMg: 0
  },
  category: 'Panadería',
  typicalTime: '08:00'
};'''
new = '''const details = {
  schemaVersion: 2,
  canonicalUnit: 'g',
  nutritionPer100: {
    calories: 160,
    protein: 8,
    carbs: 24,
    fat: 4,
    fiber: 3,
    sodiumMg: 210,
    cholesterolMg: 0
  },
  portions: [],
  category: 'Panadería',
  typicalTime: '08:00'
};'''
if old not in text:
    raise RuntimeError('food library V1 fixture not found')
text = text.replace(old, new, 1)
text = text.replace("test('normalizes Chilean decimal portions without changing their base', () => {\n  assert.deepEqual(parseFoodPortion('1,5 taza'), {\n    baseAmount: 1.5,\n    unit: 'cup',\n    normalized: '1.5cup'\n  });\n  assert.deepEqual(parseFoodPortion(' 250 ml '), {\n    baseAmount: 250,\n    unit: 'ml',\n    normalized: '250ml'\n  });\n});", "test('normalizes canonical g/ml portions', () => {\n  assert.deepEqual(parseFoodPortion('1,5 g'), { canonicalQuantity: 1.5, unit: 'g', normalized: '1.5g' });\n  assert.deepEqual(parseFoodPortion(' 250 ml '), { canonicalQuantity: 250, unit: 'ml', normalized: '250ml' });\n});")
text = text.replace("  assert.equal(parseFoodPortion('una cucharada'), null);", "  assert.equal(parseFoodPortion('1 taza'), null);\n  assert.equal(parseFoodPortion('una cucharada'), null);")
FOOD_TEST.write_text(text)

text = MF_TEST.read_text()
old = '''  assert.equal(plan.templates[0].details.baseAmount, 1);
  assert.equal(plan.templates[0].details.unit, 'portion');
  assert.equal(plan.templates[0].details.servingLabel, 'slices');
  assert.equal(plan.templates[0].details.gramsPerUnit, 27.5);
  assert.equal(plan.templates[0].details.nutrition.calories, 70.5);
  assert.equal(plan.logs[0].quantity, 4);
  assert.equal(plan.logs[0].nutritionSnapshot.nutrition.calories * plan.logs[0].quantity, 282);'''
new = '''  assert.equal(plan.templates[0].details.schemaVersion, 2);
  assert.equal(plan.templates[0].details.canonicalUnit, 'g');
  assert.deepEqual(plan.templates[0].details.portions[0], {
    id: 'macrofactor-serving', name: 'slices', portionQuantity: 1, canonicalQuantity: 27.5,
  });
  assert.equal(plan.templates[0].details.nutritionPer100.calories, 282 / 110 * 100);
  assert.equal(plan.logs[0].canonicalQuantity, 110);
  assert.equal(plan.logs[0].entry.enteredQuantity, 4);
  assert.equal(plan.logs[0].entry.portionSnapshot.canonicalQuantity, 27.5);
  assert.equal(plan.logs[0].nutritionSnapshot.nutritionPer100.calories * plan.logs[0].canonicalQuantity / 100, 282);'''
if old not in text:
    raise RuntimeError('MacroFactor V1 test marker not found')
text = text.replace(old, new, 1)
text = text.replace('assert.equal(updated.logs[0].quantity, 20);', 'assert.equal(updated.logs[0].canonicalQuantity, 20);')
MF_TEST.write_text(text)
