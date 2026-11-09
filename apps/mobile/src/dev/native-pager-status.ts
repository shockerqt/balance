/** Bounded local support trace. Values are indices/revisions, never user records. */
export type PagerEventKind = 'mount' | 'unmount' | 'render' | 'selected' | 'state' | 'queued' | 'accepted' | 'rejected' | 'skip';
export type PagerPhase = 'idle' | 'dragging' | 'settling' | 'missing';
export type PagerReason = 'surface-unmounted' | 'old-surface' | 'inactive' | 'selection-locked' | 'root-revision' | 'invalid-index' | 'same-date' | 'delegate-rejected' | 'unmounted' | 'new-gesture' | 'not-idle' | 'new-idle' | 'revision' | 'same-index' | 'selected-shape' | 'state-shape' | 'await-initial-page';
export type PagerEventDetails = { index?: number; revision?: number; expected?: number; phase?: PagerPhase; reason?: PagerReason };
type PagerEvent = Readonly<PagerEventDetails & { sequence: number; kind: PagerEventKind }>;
type PagerSnapshot = Readonly<{
  counts: Readonly<Record<PagerEventKind, number>>;
  lastIndex: number | null;
  lastPhase: string;
  lastResult: string;
  events: readonly PagerEvent[];
}>;
const empty = (): PagerSnapshot => ({ counts: { mount: 0, unmount: 0, render: 0, selected: 0, state: 0, queued: 0, accepted: 0, rejected: 0, skip: 0 },
  lastIndex: null, lastPhase: 'none', lastResult: 'none', events: [] });
let snapshot = empty(), sequence = 0;
const listeners = new Set<() => void>();
export const getNativePagerStatus = () => snapshot;
export const subscribeNativePagerStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function recordNativePagerEvent(kind: PagerEventKind, details: PagerEventDetails = {}) {
  const event: PagerEvent = { sequence: ++sequence, kind,
    ...(Number.isSafeInteger(details.index) ? { index: details.index } : {}),
    ...(Number.isSafeInteger(details.revision) ? { revision: details.revision } : {}),
    ...(Number.isSafeInteger(details.expected) ? { expected: details.expected } : {}),
    ...(details.phase ? { phase: details.phase } : {}), ...(details.reason ? { reason: details.reason } : {}) };
  snapshot = { counts: { ...snapshot.counts, [kind]: snapshot.counts[kind] + 1 },
    lastIndex: kind === 'selected' && event.index !== undefined ? event.index : snapshot.lastIndex,
    lastPhase: kind === 'state' ? event.phase ?? 'missing' : snapshot.lastPhase,
    lastResult: ['accepted', 'rejected', 'skip'].includes(kind) ? event.reason ?? kind : snapshot.lastResult,
    events: [...snapshot.events.slice(-15), event] };
  listeners.forEach(listener => listener());
}
export function resetNativePagerStatus() {
  snapshot = empty(); sequence = 0; listeners.forEach(listener => listener());
}
export function nativePagerStatusText(value = snapshot) {
  return [
    `Pager selected=${value.counts.selected} state=${value.counts.state} queued=${value.counts.queued} accepted=${value.counts.accepted} rejected=${value.counts.rejected}`,
    `Last index=${value.lastIndex ?? 'none'} phase=${value.lastPhase} result=${value.lastResult}`,
    ...value.events.map(event => `${event.sequence} ${event.kind}${event.index === undefined ? '' : ` index=${event.index}`}${event.phase ? ` phase=${event.phase}` : ''}${event.revision === undefined ? '' : ` rev=${event.revision}`}${event.expected === undefined ? '' : ` expected=${event.expected}`}${event.reason ? ` ${event.reason}` : ''}`),
  ].join('\n');
}
