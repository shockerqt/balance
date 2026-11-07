export type PagerCommit = { phase: number; durationMs: number; sinceCommandMs: number | null };

/** Bounded local timing/count evidence. Never records dates, foods or accounts. */
export function createPagerDiagnostics() {
  let enabled = false;
  let startedAt: number | null = null;
  let command: 'settle' | 'jump' | null = null;
  let samples: (PagerCommit & { command: 'settle' | 'jump' | null })[] = [];
  return {
    start: () => { enabled = true; startedAt = null; command = null; samples = []; },
    stop: () => { enabled = false; },
    command: (kind: 'settle' | 'jump') => {
      if (enabled) { command = kind; startedAt = performance.now(); }
    },
    commit: (phase: number, durationMs: number, commitTime: number) => {
      if (!enabled) return;
      samples.push({ phase, durationMs, command,
        sinceCommandMs: startedAt === null ? null : commitTime - startedAt });
      if (samples.length > 1000) samples.shift();
      startedAt = null;
      command = null;
    },
    results: () => ({ commits: samples.length, dragCommits: samples.filter(s => s.phase === 1).length,
      samples: samples.map(sample => ({ ...sample })) }),
  };
}
