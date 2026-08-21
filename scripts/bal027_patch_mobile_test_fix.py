from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'apps/mobile/tests/macro-factor-import.test.mjs'
text = TEST.read_text()
replacements = {
    "  assert.equal(plan.templates[0].details.nutritionPer100.calories, 282 / 110 * 100);":
        "  assert.ok(Math.abs(plan.templates[0].details.nutritionPer100.calories - (282 / 110 * 100)) < 1e-10);",
    "  assert.equal(plan.logs[0].nutritionSnapshot.nutritionPer100.calories * plan.logs[0].canonicalQuantity / 100, 282);":
        "  assert.ok(Math.abs(plan.logs[0].nutritionSnapshot.nutritionPer100.calories * plan.logs[0].canonicalQuantity / 100 - 282) < 1e-10);",
}
for old, new in replacements.items():
    if old not in text:
        raise RuntimeError(f'MacroFactor precision assertion marker not found: {old}')
    text = text.replace(old, new, 1)
TEST.write_text(text)
