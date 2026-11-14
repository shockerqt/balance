import type { SharedValue } from 'react-native-reanimated';

/** Page-local presentation only; canonical navigation stays in NativeDayWindow. */
export type PageEntryEvidence = {
  connected: boolean;
  current: boolean;
  header: boolean;
  nativeZero: boolean;
  coreZero: boolean;
  committedRange: boolean;
  measuredRange: boolean;
};

/** Native, Legend and committed native content are separate readiness facts. */
export function canEnterPage(evidence: PageEntryEvidence) {
  'worklet';
  return evidence.connected && evidence.current && evidence.header && evidence.nativeZero
    && evidence.coreZero && evidence.committedRange && evidence.measuredRange;
}

export type DiaryPagerMotion = {
  surface: number;
  enabled: boolean;
  initial: number;
  visual: number;
  position: number;
  selected: number;
  phase: number;
  initialized: boolean;
  serial: number;
  cleanup: number | null;
};

export type DiaryPagePresentation = {
  motion: SharedValue<DiaryPagerMotion>;
  ready: SharedValue<Record<string, boolean>>;
  interaction: SharedValue<number>;
  headerTouch: (down: boolean) => void;
};

export function createDiaryMotion(day: number, surface: number): DiaryPagerMotion {
  'worklet';
  return { surface, enabled: true, initial: day, visual: day, position: day, selected: day,
    phase: 0, initialized: false, serial: 0, cleanup: null };
}

export function observePagerMotion(current: DiaryPagerMotion, kind: 'scroll' | 'selected' | 'state', value: number): DiaryPagerMotion {
  'worklet';
  if (!current.enabled || !Number.isFinite(value)) return current;
  let next = current;
  if (kind === 'scroll') next = { ...current, position: value };
  else if (kind === 'selected') {
    if (!current.initialized && value !== current.initial) return current;
    next = { ...current, selected: value, initialized: true };
  } else next = { ...current, phase: value, initialized: current.initialized || value !== 0 };
  // Crossing an integer while dragging is not a successful page change. The
  // native idle/selected/final-frame facts must agree, in either event order.
  if (next.phase === 0 && next.initialized && Math.abs(next.position - next.selected) < 0.001 && next.visual !== next.selected) {
    next = { ...next, visual: next.selected, cleanup: next.visual, serial: next.serial + 1 };
  }
  return next;
}

export function preparedNeighbors(day: number, ready: Record<string, boolean>) {
  'worklet';
  return ready[String(day - 1)] === true && ready[String(day)] === true && ready[String(day + 1)] === true;
}

export function pageGeometry(headerFull: number, headerCompact: number, summaryFull: number, summaryCompact: number) {
  'worklet';
  const expanded = headerFull + summaryFull;
  const compact = headerCompact + summaryCompact;
  return { expanded, compact, distance: Math.max(1, expanded - compact), prefix: expanded + 12 };
}

export function snapRunway(intrinsic: number, viewport: number, distance: number) {
  'worklet';
  const overflow = intrinsic - viewport;
  return overflow > 0 ? Math.max(0, distance - overflow) : 0;
}
