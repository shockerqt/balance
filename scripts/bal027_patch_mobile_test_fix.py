from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'apps/mobile/tests/macro-factor-import.test.mjs'
text = TEST.read_text()
old = "  assert.equal(plan.templates[0].details.nutritionPer100.calories, 282 / 110 * 100);"
new = "  assert.ok(Math.abs(plan.templates[0].details.nutritionPer100.calories - (282 / 110 * 100)) < 1e-10);"
if old not in text:
    raise RuntimeError('MacroFactor precision assertion marker not found')
TEST.write_text(text.replace(old, new, 1))
