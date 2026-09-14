import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogNavigation } from '../src/lib/log-navigation.ts';

globalThis.__DEV__ = true;
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
const { installLogPerformance, beginLogNavigation, recordLogRender } = await import('../src/dev/log-performance.ts');

test('profiling is opt-in and stopping a replay cancels subsequent date commands', async () => {
  const navigation = createLogNavigation('2026-09-02', beginLogNavigation);
  installLogPerformance(navigation);
  const api = globalThis.__BALANCE_LOG_PERF__;
  navigation.set('2026-09-03');
  assert.equal(api.results().samples.length, 0);
  let commands = 0;
  navigation.subscribe(() => {
    commands++;
    recordLogRender('screen', navigation.getRevision(), 0, 1, performance.now());
  });
  const replay = api.benchmark(['2026-09-04', '2026-09-05'], 2);
  const rejection = assert.rejects(replay, /stopped|changed|Frame callbacks/);
  api.stop();
  await rejection;
  assert.equal(commands, 1);
  assert.equal(navigation.get(), '2026-09-04');
  assert.equal(api.status().running, false);
  assert.equal(api.status().enabled, false);
  assert(!JSON.stringify(api.results()).includes('2026-09'));
});
