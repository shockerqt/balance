import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeBalanceTheme, parseThemePreferences, tokens } from '../src/theme/palettes.ts';
import { type } from '../src/theme/tokens.ts';

const rgb = hex => hex.slice(1, 7).match(/../g).map(x => parseInt(x, 16));
const luminance = c => { const n = c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return n[0] * .2126 + n[1] * .7152 + n[2] * .0722; };
const contrast = (a, b) => { const x = luminance(rgb(a)), y = luminance(rgb(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };

test('both schemes keep text at 4.5:1 and meters/controls at 3:1 on ground and surface', () => {
  for (const scheme of ['light', 'dark']) {
    const t = tokens[scheme];
    for (const bg of [t.ground, t.surface]) {
      for (const ink of [t.ink, t.ink2, t.link, t.danger]) assert(contrast(ink, bg) >= 4.5, `${scheme}: ${ink} on ${bg}`);
      for (const mark of [t.protein, t.carbs, t.fat, t.bar]) assert(contrast(mark, bg) >= 3, `${scheme}: ${mark} on ${bg}`);
    }
    assert(contrast(t.onInk, t.ink) >= 4.5, `${scheme}: text on ink`);
    const c = makeBalanceTheme(scheme).colors;
    for (const [role, value] of Object.entries(c)) assert.match(value, /^#[0-9A-F]{6}([0-9A-F]{2})?$/i, `${scheme}.${role} must be opaque hex for native parsing`);
    assert.equal(c.background, t.ground); assert.equal(c.primary, t.ink); assert.equal(c.macroProtein, t.protein);
  }
});

test('the light tokens are the approved redesign values', () => {
  assert.deepEqual([tokens.light.ground, tokens.light.surface, tokens.light.ink, tokens.light.ink2, tokens.light.line, tokens.light.lineStrong, tokens.light.track, tokens.light.protein, tokens.light.carbs, tokens.light.fat],
    ['#F7F7F5', '#FFFFFF', '#16181D', '#5A606B', '#E4E5E1', '#D5D7D2', '#ECEDE9', '#2F5BEA', '#B97A00', '#C2336B']);
});

test('type scale never goes below 12 and custom families never request a synthetic weight', () => {
  for (const [name, style] of Object.entries(type)) {
    assert(style.fontSize >= 12, `${name} is ${style.fontSize}`);
    assert.ok(style.fontFamily, `${name} needs an explicit family`);
    assert.equal(style.fontWeight, undefined, `${name} must not set fontWeight`);
  }
});

test('device preference migration keeps appearance and drops the retired colour choice', () => {
  assert.deepEqual(parseThemePreferences(null), { appearance: 'system' });
  assert.deepEqual(parseThemePreferences(null, 'libro'), { appearance: 'light' });
  assert.deepEqual(parseThemePreferences(null, 'libroNoche'), { appearance: 'dark' });
  assert.deepEqual(parseThemePreferences('{"appearance":"light","colorSource":"lagoon"}', 'libroNoche'), { appearance: 'light' });
  assert.deepEqual(parseThemePreferences('{"appearance":"sepia"}'), { appearance: 'system' });
  assert.deepEqual(parseThemePreferences('{oops'), { appearance: 'system' });
});

test('no gradient backgrounds or retired palettes remain in the app source', () => {
  const root = path.resolve(import.meta.dirname, '../src');
  const files = fs.readdirSync(root, { recursive: true }).filter(f => /\.(tsx?|jsx?)$/.test(f)).map(f => path.join(root, f));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /experimental_backgroundImage|linear-gradient|organic-palettes|gradientBackground/, file);
  }
});
