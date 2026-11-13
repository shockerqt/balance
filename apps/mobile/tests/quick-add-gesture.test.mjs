import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionPlusGesture as step, radialSelection, HOURS } from '../src/lib/quick-add-gesture.ts';
const start = () => step(null, { type: 'start', id: 1, x: 0, y: 0, time: 0 });
test('tap, continuous left weight/right now, return to center and down cancellation', () => {
  assert.equal(step(start(), { type: 'release', x: 0, y: 0, time: 100 }).outcome, 'tap');
  for (const [x, outcome] of [[-60, 'weight'], [60, 'food']]) {
    const moved = step(start(), { type: 'move', x, y: 0, time: 100 });
    assert.equal(step(moved, { type: 'release', x, y: 0, time: 150 }).outcome, outcome);
    assert.equal(step(moved, { type: 'release', x: 0, y: 0, time: 150 }).outcome, 'cancel');
  }
  assert.equal(step(start(), { type: 'release', x: 0, y: 41, time: 100 }).outcome, 'cancel');
});
test('hold is 350ms and upward drag enters radial without lifting; release chooses or cancels', () => {
  assert.equal(step(start(), { type: 'hold', time: 349 }).phase, 'pending');
  assert.equal(step(start(), { type: 'hold', time: 350 }).phase, 'radial');
  const radial = step(start(), { type: 'move', x: 0, y: -32, time: 100 });
  assert.equal(radial.phase, 'radial');
  assert.equal(step(radial, { type: 'release', x: 0, y: -100, time: 200, hour: 23 }).outcome, 23);
  assert.equal(step(radial, { type: 'release', x: 0, y: -100, time: 200, hour: null }).outcome, 'cancel');
});
const point = (angle, radius = 112) => ({ x: 144 + radius * Math.cos(angle * Math.PI / 180), y: 144 + radius * Math.sin(angle * Math.PI / 180) + 24 });
const box = { left: 0, top: 0, width: 288, height: 288 };
test('ascending 05–23 radial uses 24dp raised cursor, exact endpoints and 3degree hysteresis', () => {
  HOURS.forEach((hour, i) => { const p = point(126 + i * 16); assert.equal(radialSelection(p.x, p.y, box), hour); });
  let p = point(126 + 4 * 16 + 10); assert.equal(radialSelection(p.x, p.y, box, 9), 9);
  p = point(126 + 4 * 16 + 12); assert.equal(radialSelection(p.x, p.y, box, 9), 10);
  assert.equal(radialSelection(144, 168, box), null);
  p = point(90); assert.equal(radialSelection(p.x, p.y, box), null);
  p = point(270, 150); assert.equal(radialSelection(p.x, p.y, box), null);
});
