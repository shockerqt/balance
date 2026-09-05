import type { ProfilerOnRenderCallback } from 'react';

type Sample = {
  revision: number;
  foodCount: number;
  startedAt: number;
  firstCommitMs: number | null;
  nextFrameMs: number | null;
  twoFramesMs: number | null;
  screenRenderMs: number;
  feedRenderMs: number;
  summaryRenderMs: number;
  headerRenderMs: number;
  foodRenders: number;
  commits: number;
};
type Navigation = { get: () => string; set: (date: string) => void };

// Local, opt-in development diagnostics. Never include dates, names or identities.
const samples: Sample[] = [];
let enabled = false;
let pending: Sample | null = null;
let label = 'baseline';
let running = false;
let generation = 0;
let navigation: Navigation | null = null;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function beginLogNavigation(revision: number) {
  if (!__DEV__ || !enabled) return;
  pending = {
    revision, foodCount: 0, startedAt: performance.now(),
    firstCommitMs: null, nextFrameMs: null, twoFramesMs: null,
    screenRenderMs: 0, feedRenderMs: 0, summaryRenderMs: 0, headerRenderMs: 0,
    foodRenders: 0, commits: 0,
  };
  samples.push(pending);
  if (samples.length > 1000) samples.shift();
}

export function countFoodRender() {
  if (__DEV__ && enabled && pending) pending.foodRenders += 1;
}

export function recordLogRender(
  id: 'screen' | 'feed' | 'summary' | 'header',
  revision: number,
  foodCount: number,
  actualDuration: number,
  commitTime: number,
) {
  if (!__DEV__ || !enabled || !pending || pending.revision !== revision) return;
  const sample = pending;
  sample.foodCount = foodCount;
  sample[`${id}RenderMs`] += actualDuration;
  if (id !== 'screen') return;
  sample.commits += 1;
  if (sample.firstCommitMs !== null) return;
  sample.firstCommitMs = commitTime - sample.startedAt;
  // Frame callbacks are scheduling proxies, NOT proof of native pixel presentation.
  requestAnimationFrame(() => {
    if (pending !== sample) return;
    sample.nextFrameMs = performance.now() - sample.startedAt;
    requestAnimationFrame(() => {
      if (pending === sample) sample.twoFramesMs = performance.now() - sample.startedAt;
    });
  });
}

export function logRenderCallback(
  id: 'screen' | 'feed' | 'summary' | 'header', revision: number, foodCount: number,
): ProfilerOnRenderCallback {
  return (_id, _phase, duration, _base, _start, commit) => {
    recordLogRender(id, revision, foodCount, duration, commit);
  };
}

export function installLogPerformance(nav: Navigation) {
  if (!__DEV__) return;
  navigation = nav;
  const api = {
    start: (name = 'manual') => {
      if (running) throw new Error('Benchmark already running');
      label = name; samples.length = 0; pending = null; enabled = true;
    },
    stop: () => { generation += 1; enabled = false; pending = null; },
    status: () => ({ enabled, running, label, samples: samples.length }),
    results: () => ({ label, samples: samples.map(({ startedAt: _start, ...sample }) => ({ ...sample })) }),
    // Bounded, read-only navigation replay on the actual screen. No food mutations.
    benchmark: async (dates: string[], repetitions = 2, name = 'baseline') => {
      if (running || !navigation) throw new Error('Benchmark unavailable');
      if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20 || dates.length < 2 || dates.length > 14 ||
          dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        throw new Error('Invalid benchmark bounds');
      }
      const nav = navigation;
      const original = nav.get();
      api.start(name);
      running = true;
      const currentGeneration = ++generation;
      let interrupted = false;
      try {
        for (let pass = 0; pass < repetitions; pass++) {
          for (const date of dates) {
            if (generation !== currentGeneration) { interrupted = true; throw new Error('Benchmark stopped'); }
            nav.set(date);
            const sample = pending;
            // Allow the expensive baseline to finish instead of truncating slow samples.
            const deadline = performance.now() + 5000;
            while (sample && sample.twoFramesMs === null && performance.now() < deadline && generation === currentGeneration) {
              await pause(50);
            }
            if (sample && sample.twoFramesMs === null) {
              interrupted = true;
              throw new Error('Frame callbacks unavailable; keep the app in the foreground');
            }
            await pause(200);
            if (generation !== currentGeneration || nav.get() !== date) {
              interrupted = true;
              throw new Error('Navigation changed during benchmark; stopped');
            }
          }
        }
        return api.results();
      } finally {
        enabled = false; pending = null; running = false;
        if (!interrupted) nav.set(original);
      }
    },
  };
  (globalThis as typeof globalThis & { __BALANCE_LOG_PERF__?: typeof api }).__BALANCE_LOG_PERF__ = api;
}
