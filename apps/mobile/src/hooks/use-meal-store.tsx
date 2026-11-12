import { API_BASE_URL } from '@/services/config';
import { authDataNamespace } from '@/services/auth/session-state';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { storage } from '@/services/storage';
import { useAuth } from './use-auth';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { logToLoggedFood, snapshotFromDisplayFood } from '@/services/sync/adapters';
import { MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc } from '@/services/sync/types';
import { updateMealLogQuantityAndTime } from '@/lib/food-portions';
import { parsePortion } from '@/lib/portion';
import { sumNutrition } from '@/lib/nutrition';
import { createMealDayProjector, createMealDaySubscriptions } from '@/lib/meal-day-projection';
export { createMealDayProjector, emptyDayLog } from '@/lib/meal-day-projection';
import { recoverGuestImport } from '@/services/import/guest-import';
import { epochForChileDateTime } from '@/lib/dates';
export { toDateId, todayId, displayDateFor } from '@/lib/dates';
import type { DayTargets } from '@/lib/day-targets';
export { DEFAULT_TARGETS, type DayTargets } from '@/lib/day-targets';

export interface LoggedFoodItem {
  id: string;
  templateId?: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  time: string;
  chileanSeals?: string[];
}

type MealLogEditableFields = Pick<LoggedFoodItem, 'portion' | 'time'>;

export interface DayLog extends DayTargets {
  dateId: string;
  displayDate: string;
  foods: LoggedFoodItem[];
}


function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mergeLogs(previous: MealLogDoc[], incoming: SyncDocument[], keepCurrentRevision = false): MealLogDoc[] {
  const byId = new Map(previous.map((doc) => [doc.id, doc]));
  for (const value of incoming) {
    if (!isMealLogDoc(value)) continue;
    const current = byId.get(value.id);
    if (!current || value.updatedAt > current.updatedAt ||
        (!keepCurrentRevision && value.updatedAt === current.updatedAt && value.id >= current.id)) byId.set(value.id, value);
  }
  return Array.from(byId.values());
}

function persistLogs(namespace: string, docs: MealLogDoc[]): Promise<void> {
  return storage.setItem(collectionStorageKey(namespace, 'mealLogs'), JSON.stringify(docs));
}

function docFromFood(dateId: string, food: Omit<LoggedFoodItem, 'id'>, id: string, updatedAt = Date.now()): MealLogDoc | null {
  const parsed = parsePortion(food.portion);
  const quantity = parsed.quantity > 0 ? parsed.quantity : 1;
  const normalizedPortion = `${quantity}${parsed.unit}`;
  let snapshot: NutritionSnapshot;
  try {
    snapshot = snapshotFromDisplayFood({ ...food, portion: normalizedPortion });
  } catch {
    return null;
  }
  const consumedAt = epochForChileDateTime(dateId, food.time);
  if (consumedAt === null) return null;
  return {
    id,
    templateId: food.templateId ?? null,
    nameSnapshot: food.name,
    nutritionSnapshot: snapshot,
    canonicalQuantity: quantity,
    entry: { enteredQuantity: quantity },
    consumedAt,
    updatedAt,
    _deleted: false,
  };
}

interface MealStoreContextType {
  dayLogs: Record<string, DayLog>;
  mealDocuments: MealLogDoc[];
  registerMealLog: (document: MealLogDoc) => Promise<void>;
  registerMealLogs: (documents: MealLogDoc[]) => Promise<void>;
  addFood: (dateId: string, food: Omit<LoggedFoodItem, 'id'>) => void;
  addMultipleFoods: (dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => void;
  updateFood: (dateId: string, foodId: string, updated: Partial<MealLogEditableFields>) => void;
  deleteFood: (dateId: string, foodId: string) => void;
  deleteMultipleFoods: (dateId: string, foodIds: string[]) => void;
  moveMultipleFoodsTime: (dateId: string, foodIds: string[], newTime: string) => void;
  replaceMealDocuments: (documents: MealLogDoc[]) => void;
}

type MealActions = Omit<MealStoreContextType, 'dayLogs' | 'mealDocuments'>;
const MealActionsContext = createContext<MealActions | undefined>(undefined);
const MealDayContext = createContext<ReturnType<typeof createMealDaySubscriptions> | undefined>(undefined);

const MealStoreContext = createContext<MealStoreContextType | undefined>(undefined);

export const MealStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const namespace = user ? authDataNamespace(API_BASE_URL, user.id) : 'guest';
  const scope = useMemo(() => ({ active: true }), [namespace]);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const currentNamespace = useRef(namespace);
  currentNamespace.current = namespace;
  const [logs, setLogs] = useState<MealLogDoc[]>([]);
  const logsRef = useRef<MealLogDoc[]>([]);
  const logsNamespace = useRef(namespace);
  const cacheValid = useRef(false);
  const updateLogs = useCallback((update: (previous: MealLogDoc[]) => MealLogDoc[]) => {
    if (currentNamespace.current !== namespace) return Promise.resolve();
    const next = update(logsRef.current);
    logsRef.current = next;
    setLogs(next);
    const trusted = cacheValid.current && storage.isDurableItem(collectionStorageKey(namespace, 'mealLogs'));
    const persisted = (async () => {
      if (!trusted) await syncClient.invalidateCollectionCheckpoint('mealLogs', namespace);
      await persistLogs(namespace, next);
    })();
    void persisted.catch(() => {
      if (currentNamespace.current === namespace) syncClient.reportLocalPersistenceError('mealLogs');
    });
    return persisted;
  }, [namespace]);

  useEffect(() => {
    let cancelled = false;
    scope.active = true;
    logsRef.current = [];
    logsNamespace.current = namespace;
    cacheValid.current = false;
    setLogs([]);
    const ready = (async () => {
      if (namespace === 'guest') await recoverGuestImport().catch(() => null);
      const raw = await storage.getItem(collectionStorageKey(namespace, 'mealLogs')).catch(() => null);
      if (cancelled) return;
      let cached: MealLogDoc[] = [];
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          cached = parsed.filter(isMealLogDoc);
          cacheValid.current = !!raw && parsed.every(isMealLogDoc);
        }
      } catch {
        // Ignore corrupt cache; PostgreSQL is authoritative after reconnect.
      }
      // Durable outbox recovery is independent of cache validity, including a
      // process interrupted after enqueue but before its first cache commit.
      const pending = await syncClient.pendingDocuments('mealLogs', namespace).catch(() => []);
      if (cancelled) return;
      // A canonical conflict can be committed before outbox retirement fails
      // or the process stops. Keep that durable revision on equal timestamps;
      // pending/optimistic overlays still supply missing and newer documents.
      const next = mergeLogs(mergeLogs(cached, pending, true), logsRef.current, true);
      logsRef.current = next;
      setLogs(next);
    })();
    readyRef.current = ready;
    const unregister = syncClient.registerCollection('mealLogs', {
      canResume: () => !cancelled && cacheValid.current && storage.isDurableItem(collectionStorageKey(namespace, 'mealLogs')),
      onDocuments: async (documents, _result, options) => {
        if (cancelled || currentNamespace.current !== namespace) return;
        if (options?.deferPersistence) {
          logsRef.current = mergeLogs(logsRef.current, documents);
          return;
        }
        await updateLogs(previous => mergeLogs(previous, documents));
        if (!cancelled && currentNamespace.current === namespace) cacheValid.current = true;
      },
      flush: async () => {
        if (cancelled || currentNamespace.current !== namespace) return;
        await updateLogs(previous => previous);
        if (!cancelled && currentNamespace.current === namespace) {
          cacheValid.current = true;
        }
      },
      onPushConflicts: async (documents) => {
        // Even a conflict-free ACK must consolidate outbox-only saves before
        // SyncClient can retire their durable queue entries.
        await ready;
        const pending = await syncClient.pendingDocuments('mealLogs', namespace);
        if (cancelled) return;
        await updateLogs(previous => mergeLogs(mergeLogs(previous, pending), documents));
      },
      onPushRejected: (rejections) => {
        const rejectedRevisions = new Map(
          rejections.filter((value) => isMealLogDoc(value.document)).map((value) => [value.document.id, value.document.updatedAt])
        );
        if (cancelled || !rejectedRevisions.size) return;
        const persisted = updateLogs(previous => previous.filter(doc => {
          const rejectedAt = rejectedRevisions.get(doc.id);
          // An answer belongs to its sent revision, not an edit queued while
          // that answer was in flight. Keep the newer local value visible.
          return rejectedAt === undefined || doc.updatedAt > rejectedAt;
        }));
        void syncClient.resetCollection('mealLogs');
        return persisted;
      },
    }, ready);
    return () => {
      cancelled = true;
      scope.active = false;
      unregister();
    };
  }, [namespace, updateLogs, scope]);

  // Outbox persistence owns durability; only acknowledge the native editor
  // after enqueue succeeds. Never publish a late save into a different account.
  const registerMealLogs = useCallback(async (documents: MealLogDoc[]) => {
    if (!documents.length || new Set(documents.map(doc => doc.id)).size !== documents.length ||
        documents.some(document => !isMealLogDoc(document) || document._deleted)) throw new Error('INVALID_MEAL_LOG');
    if (!scope.active || currentNamespace.current !== namespace) throw new Error('STALE_ACCOUNT');
    await syncClient.enqueueBatch('mealLogs', documents.map(document => ({ document })));
    if (!scope.active || currentNamespace.current !== namespace) return;
    // A macrotask lets the editor observe the durable receipt before any full
    // history merge/stringify or derived React/native work. Never persist a
    // partial history over a cache whose hydration is still in flight.
    const ready = readyRef.current;
    setTimeout(() => {
      void (async () => {
        if (!scope.active || currentNamespace.current !== namespace) return;
        const pending = await syncClient.pendingDocuments('mealLogs', namespace);
        if (!scope.active || currentNamespace.current !== namespace || !pending.length) return;
        // An ACK/conflict may already have applied the same revision while this
        // timer waited. Its canonical result wins over a late queue overlay.
        const visible = mergeLogs(logsRef.current, pending, true);
        logsRef.current = visible;
        setLogs(visible);
        await ready;
        if (!scope.active || currentNamespace.current !== namespace) return;
        const remaining = await syncClient.pendingDocuments('mealLogs', namespace);
        if (!scope.active || currentNamespace.current !== namespace || !remaining.length) return;
        await updateLogs(previous => mergeLogs(previous, remaining, true));
      })().catch(() => {
        if (scope.active && currentNamespace.current === namespace) syncClient.reportLocalPersistenceError('mealLogs');
      });
    }, 0);
  }, [namespace, updateLogs, scope]);

  const registerMealLog = useCallback((document: MealLogDoc) => registerMealLogs([document]), [registerMealLogs]);

  const addFood = useCallback((dateId: string, food: Omit<LoggedFoodItem, 'id'>) => {
    const doc = docFromFood(dateId, food, uuid());
    if (!doc) return;
    void updateLogs(previous => mergeLogs(previous, [doc]));
    void syncClient.enqueue('mealLogs', doc).catch(() => undefined);
  }, [namespace, updateLogs]);

  const addMultipleFoods = useCallback((dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => {
    if (!foods.length) return;
    const docs = foods.map((food) => docFromFood(dateId, food, uuid())).filter((doc): doc is MealLogDoc => doc !== null);
    if (!docs.length) return;
    void updateLogs(previous => mergeLogs(previous, docs));
    for (const doc of docs) void syncClient.enqueue('mealLogs', doc).catch(() => undefined);
  }, [namespace, updateLogs]);

  const updateFood = useCallback((dateId: string, foodId: string, updated: Partial<MealLogEditableFields>) => {
    void updateLogs((previous) => {
      const current = previous.find((doc) => doc.id === foodId);
      if (!current) return previous;
      const display = logToLoggedFood(current);
      const consumedAt = epochForChileDateTime(dateId, updated.time ?? display.time);
      if (consumedAt === null) return previous;
      const nextDoc = updateMealLogQuantityAndTime(
        current,
        updated.portion ?? display.portion,
        consumedAt,
        Math.max(Date.now(), current.updatedAt + 1)
      );
      if (!nextDoc) return previous;
      const next = mergeLogs(previous, [nextDoc]);
      void syncClient.enqueue('mealLogs', nextDoc).catch(() => undefined);
      return next;
    });
  }, [namespace, updateLogs]);

  const deleteFood = useCallback((dateId: string, foodId: string) => {
    void dateId;
    void updateLogs((previous) => {
      const current = previous.find((doc) => doc.id === foodId);
      if (!current) return previous;
      const deleted = { ...current, updatedAt: Math.max(Date.now(), current.updatedAt + 1), _deleted: true };
      const next = mergeLogs(previous, [deleted]);
      void syncClient.enqueue('mealLogs', deleted).catch(() => undefined);
      return next;
    });
  }, [namespace, updateLogs]);

  const deleteMultipleFoods = useCallback((dateId: string, foodIds: string[]) => {
    void dateId;
    const ids = new Set(foodIds);
    void updateLogs((previous) => {
      const deleted = previous.filter((doc) => ids.has(doc.id)).map((doc) => ({ ...doc, updatedAt: Math.max(Date.now(), doc.updatedAt + 1), _deleted: true }));
      if (!deleted.length) return previous;
      const next = mergeLogs(previous, deleted);
      for (const doc of deleted) void syncClient.enqueue('mealLogs', doc).catch(() => undefined);
      return next;
    });
  }, [namespace, updateLogs]);

  const moveMultipleFoodsTime = useCallback((dateId: string, foodIds: string[], newTime: string) => {
    const ids = new Set(foodIds);
    const consumedAt = epochForChileDateTime(dateId, newTime);
    if (consumedAt === null) return;
    void updateLogs((previous) => {
      const changed = previous.filter((doc) => ids.has(doc.id) && !doc._deleted).map((doc) => ({
        ...doc,
        consumedAt,
        updatedAt: Math.max(Date.now(), doc.updatedAt + 1),
      }));
      if (!changed.length) return previous;
      const next = mergeLogs(previous, changed);
      for (const doc of changed) void syncClient.enqueue('mealLogs', doc).catch(() => undefined);
      return next;
    });
  }, [namespace, updateLogs]);

  const projectDayLogs = useMemo(createMealDayProjector, [namespace]);
  const dayLogs = useMemo(() => projectDayLogs(logsNamespace.current === namespace ? logs : []), [logs, namespace, projectDayLogs]);

  const daySubscriptions = useMemo(() => createMealDaySubscriptions(), [namespace]);
  useLayoutEffect(() => { daySubscriptions.publish(dayLogs); }, [daySubscriptions, dayLogs]);

  const replaceMealDocuments = useCallback((documents: MealLogDoc[]) => {
    logsRef.current = documents;
    setLogs(documents);
  }, []);
  const value = useMemo<MealStoreContextType>(() => ({
    dayLogs,
    mealDocuments: logs,
    registerMealLog,
    registerMealLogs,
    addFood,
    addMultipleFoods,
    updateFood,
    deleteFood,
    deleteMultipleFoods,
    moveMultipleFoodsTime,
    replaceMealDocuments,
  }), [dayLogs, logs, registerMealLog, registerMealLogs, addFood, addMultipleFoods, updateFood, deleteFood, deleteMultipleFoods, moveMultipleFoodsTime, replaceMealDocuments]);
  const actions = useMemo<MealActions>(() => ({
    registerMealLog, registerMealLogs, addFood, addMultipleFoods, updateFood,
    deleteFood, deleteMultipleFoods, moveMultipleFoodsTime, replaceMealDocuments,
  }), [registerMealLog, registerMealLogs, addFood, addMultipleFoods, updateFood,
    deleteFood, deleteMultipleFoods, moveMultipleFoodsTime, replaceMealDocuments]);
  return <MealStoreContext.Provider value={value}>
    <MealActionsContext.Provider value={actions}>
      <MealDayContext.Provider value={daySubscriptions}>{children}</MealDayContext.Provider>
    </MealActionsContext.Provider>
  </MealStoreContext.Provider>;
};

export const useMealStore = () => {
  const context = useContext(MealStoreContext);
  if (!context) throw new Error('useMealStore debe usarse dentro de un MealStoreProvider');
  return context;
};

export function sumDay(foods: LoggedFoodItem[]) {
  return sumNutrition(foods);
}

/** A pane subscribes only to its own day's immutable presentation snapshot. */
export function useMealDay(dateId: string): DayLog {
  const store = useContext(MealDayContext);
  if (!store) throw new Error('useMealDay requires MealStoreProvider');
  const subscribe = useCallback((listener: () => void) => store.subscribe(dateId, listener), [store, dateId]);
  const get = useCallback(() => store.get(dateId), [store, dateId]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useMealActions(): MealActions {
  const actions = useContext(MealActionsContext);
  if (!actions) throw new Error('useMealActions requires MealStoreProvider');
  return actions;
}
