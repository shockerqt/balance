import type { DayLog, LoggedFoodItem } from '../hooks/use-meal-store';
import type { MealLogDoc } from '../services/sync/types';
import { logToLoggedFood } from '../services/sync/adapters';
import { displayDateFor, toDateId, todayId } from './dates';
import { DEFAULT_TARGETS, resolveDailyCalorieTarget } from './day-targets';

export function emptyDayLog(dateId: string, targetCalories = DEFAULT_TARGETS.targetCalories): DayLog {
  return { dateId, displayDate: displayDateFor(dateId), ...DEFAULT_TARGETS, targetCalories: resolveDailyCalorieTarget(targetCalories), foods: [] };
}

interface LazyDaySlot {
  date: string;
  docs: MealLogDoc[];
  value?: DayLog;
}

/** Presentation only. The canonical store continues to own document revisions. */
export function createMealDayProjector() {
  let previous: Record<string, DayLog> = {};
  let previousSlots = new Map<string, LazyDaySlot>();
  let previousToday = todayId();
  const documents = new Map<string, MealLogDoc>();
  const locations = new Map<string, string>();
  const days = new Map<string, Map<string, MealLogDoc>>();
  const converted = new WeakMap<MealLogDoc, LoggedFoodItem>();
  let predecessors = new Map<string, string | undefined>();
  const toLoggedFood = (document: MealLogDoc): LoggedFoodItem => {
    let food = converted.get(document);
    if (!food) {
      food = logToLoggedFood(document);
      converted.set(document, food);
    }
    return food;
  };

  return (nextDocuments: MealLogDoc[]): Record<string, DayLog> => {
    const changed = new Set<string>();
    const today = todayId();
    if (today !== previousToday) {
      if (days.has(previousToday)) changed.add(previousToday);
      if (days.has(today)) changed.add(today);
      previousToday = today;
    }
    const present = new Set<string>();
    const order = new Map<string, number>();
    const lastInDay = new Map<string, string>();
    const nextPredecessors = new Map<string, string | undefined>();
    const remove = (id: string) => {
      const date = locations.get(id);
      if (date !== undefined) {
        days.get(date)?.delete(id);
        locations.delete(id);
        changed.add(date);
      }
    };
    // Canonical snapshots are arrays: reconcile identity in O(history), and defer
    // per-document nutrition conversion and DayLog allocation until a dateId is read.
    // Predecessors detect reordered snapshots without invalidating other dates.
    for (const document of nextDocuments) {
      present.add(document.id);
      order.set(document.id, order.size);
      if (documents.get(document.id) !== document) {
        documents.set(document.id, document);
        if (document._deleted) remove(document.id);
        else {
          const date = toDateId(new Date(document.consumedAt));
          if (locations.get(document.id) !== date) remove(document.id);
          const bucket = days.get(date) ?? new Map<string, MealLogDoc>();
          bucket.set(document.id, document);
          days.set(date, bucket);
          locations.set(document.id, date);
          changed.add(date);
        }
      }
      const date = locations.get(document.id);
      if (date === undefined) continue;
      const predecessor = lastInDay.get(date);
      if (predecessors.get(document.id) !== predecessor) changed.add(date);
      nextPredecessors.set(document.id, predecessor);
      lastInDay.set(date, document.id);
    }
    for (const id of documents.keys()) {
      if (present.has(id)) continue;
      remove(id);
      documents.delete(id);
    }
    const dates = [...lastInDay.keys()];
    const previousDates = Object.keys(previous);
    if (changed.size || dates.some((date, i) => date !== previousDates[i]) || dates.length !== previousDates.length) {
      const next: Record<string, DayLog> = {};
      const nextSlots = new Map<string, LazyDaySlot>();
      for (const date of dates) {
        const slot: LazyDaySlot = (!changed.has(date) && previousSlots.get(date)) || {
          date,
          docs: [...days.get(date)!.values()].sort((a, b) => order.get(a.id)! - order.get(b.id)!),
        };
        nextSlots.set(date, slot);
        Object.defineProperty(next, date, {
          enumerable: true,
          configurable: true,
          get() {
            if (!slot.value) {
              slot.value = {
                ...emptyDayLog(slot.date),
                foods: slot.docs.map(toLoggedFood),
              };
            }
            return slot.value;
          },
        });
      }
      for (const date of changed) if (!days.get(date)?.size) days.delete(date);
      previous = next;
      previousSlots = nextSlots;
    }
    predecessors = nextPredecessors;
    return previous;
  };
}

/** Stable snapshots and notifications scoped to a date, with no persistence. */
export function createMealDaySubscriptions(initial: Record<string, DayLog> = {}) {
  let days = initial;
  const empty = new Map<string, DayLog>();
  const listeners = new Map<string, Set<() => void>>();
  const get = (date: string) => {
    if (days[date]) return days[date];
    let snapshot = empty.get(date);
    if (!snapshot) {
      snapshot = emptyDayLog(date);
      empty.set(date, snapshot);
    }
    return snapshot;
  };
  return {
    get,
    subscribe: (date: string, listener: () => void) => {
      const bucket = listeners.get(date) ?? new Set<() => void>();
      bucket.add(listener);
      listeners.set(date, bucket);
      return () => {
        bucket.delete(listener);
        if (!bucket.size) listeners.delete(date);
      };
    },
    publish: (next: Record<string, DayLog>) => {
      if (next === days) return;
      const old = days;
      days = next;
      // Install the complete snapshot before notifying any subscriber.
      for (const [date, bucket] of listeners) {
        if (old[date] !== next[date]) bucket.forEach(listener => listener());
      }
      // Retain empty snapshots only for mounted consumers. This also bounds
      // memory when repeatedly jumping across years of unrecorded dates.
      for (const date of empty.keys()) {
        if (!listeners.has(date)) empty.delete(date);
      }
    },
  };
}
