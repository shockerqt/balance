type SelectionFeedback = Pick<typeof import('expo-haptics'), 'selectionAsync'>;
let feedback: SelectionFeedback | null | undefined;

/** Metro includes the JS package, but old APKs may lack its native module. */
export function tickHourChange(previous: number | null, next: number | null): void {
  if (next === null || next === previous) return;
  try {
    if (feedback === undefined) {
      try { feedback = require('expo-haptics') as SelectionFeedback; }
      catch { feedback = null; }
    }
    if (typeof feedback?.selectionAsync !== 'function') return;
    void Promise.resolve(feedback.selectionAsync()).catch(() => undefined);
  } catch {
    // Native availability and device feedback settings never block registration.
  }
}
