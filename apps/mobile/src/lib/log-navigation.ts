import { shiftDateId } from './dates';

/** The only date authority. Rendering and animation never write back to it. */
export function createLogNavigation(initialDateId: string) {
  let dateId = initialDateId;
  let revision = 0;
  const listeners = new Set<() => void>();

  const set = (next: string) => {
    if (next === dateId) return;
    dateId = next;
    revision += 1;
    listeners.forEach((listener) => listener());
  };

  return {
    get: () => dateId,
    getRevision: () => revision,
    set,
    // Read the live date so rapid taps accumulate even before React renders.
    shift: (days: number, expectedRevision = revision) => {
      if (expectedRevision !== revision) return;
      set(shiftDateId(dateId, days));
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A cancelled, short, vertical or diagonal movement never changes the date. */
export function swipeDateOffset(x: number, y: number, success: boolean): number {
  if (!success || Math.abs(x) < 48 || Math.abs(x) < Math.abs(y) * 1.5) return 0;
  return x < 0 ? 1 : -1;
}
