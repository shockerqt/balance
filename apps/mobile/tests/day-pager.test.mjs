import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayPagerOffset, acceptDaySettle } from '../src/lib/day-pager.ts';
import { createLogNavigation } from '../src/lib/log-navigation.ts';
import { createPagerDiagnostics } from '../src/dev/pager-diagnostics.ts';

test('release uses both position and velocity, clamps to a prepared neighbor and rejects cancellation', () => {
  assert.equal(dayPagerOffset(-160, 0, 400), 1);
  assert.equal(dayPagerOffset(160, 0, 400), -1);
  assert.equal(dayPagerOffset(-20, -900, 400), 1);
  assert.equal(dayPagerOffset(20, 900, 400), -1);
  assert.equal(dayPagerOffset(-30, 0, 400), 0);
  assert.equal(dayPagerOffset(-9000, -9000, 400), 1);
  assert.equal(dayPagerOffset(-900, -900, 400, false), 0);
  assert.equal(dayPagerOffset(-900, -900, 0), 0);
});

test('settled acknowledgements cannot undo calendar jumps, including away and back, or survive blur', () => {
  const nav = createLogNavigation('2026-11-06');
  const initial = nav.getRevision();
  assert.equal(acceptDaySettle(initial, nav.getRevision(), true), true);
  assert.equal(acceptDaySettle(initial, nav.getRevision(), false), false);
  nav.set('2040-01-01'); nav.set('2026-11-06');
  assert.equal(acceptDaySettle(initial, nav.getRevision(), true), false);
  nav.shift(1, initial);
  assert.equal(nav.get(), '2026-11-06');
});

test('commit evidence is opt-in, bounded and distinguishes drags, settles and jumps', () => {
  const metrics = createPagerDiagnostics();
  metrics.commit(1, 10, performance.now());
  assert.equal(metrics.results().commits, 0);
  metrics.start();
  metrics.commit(1, 2, performance.now());
  metrics.command('settle'); metrics.commit(0, 3, performance.now());
  metrics.command('jump'); metrics.commit(0, 4, performance.now());
  assert.equal(metrics.results().dragCommits, 1);
  assert.deepEqual(metrics.results().samples.map(s => s.command), [null, 'settle', 'jump']);
  metrics.stop(); metrics.commit(1, 99, performance.now());
  assert.equal(metrics.results().commits, 3);
  metrics.start();
  for (let i = 0; i < 1100; i++) metrics.commit(0, 1, performance.now());
  assert.equal(metrics.results().commits, 1000);
});
