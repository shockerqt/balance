import { API_BASE_URL } from '@/services/config';
import { authDataNamespace } from '@/services/auth/session-state';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '@/services/storage';
import { useAuth } from './use-auth';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { logToLoggedFood, snapshotFromDisplayFood } from '@/services/sync/adapters';
import { MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc } from '@/services/sync/types';
import { updateMealLogQuantityAndTime } from '@/lib/food-portions';
import { parsePortion } from '@/lib/portion';
import { sumNutrition } from '@/lib/nutrition';
import { recoverGuestImport } from '@/services/import/guest-import';
import { epochForChileDateTime, toDateId, todayId, displayDateFor } from '@/lib/dates';
export { toDateId, todayId, displayDateFor };
import { DEFAULT_TARGETS, type DayTargets } from '@/lib/day-targets';
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

export function emptyDayLog(dateId: string): DayLog {
  return { dateId, displayDate: displayDateFor(dateId), ...DEFAULT_TARGETS, foods: [] };
}


function mergeLogs(previous: MealLogDoc[], incoming: SyncDocument[]): MealLogDoc[] {
  const byId = new Map(previous.map((doc) => [doc.id, doc]));
  for (const value of incoming) {
    if (!isMealLogDoc(value)) continue;
    const current = byId.get(value.id);
    if (!current || value.updatedAt > current.updatedAt || (value.updatedAt === current.updatedAt && value.id >= current.id)) byId.set(value.id, value);
  }
  return Array.from(byId.values());
}

function persistLogs(namespace: string, docs: MealLogDoc[]): void {
  void storage.setItem(collectionStorageKey(namespace, 'mealLogs'), JSON.stringify(docs));
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
  addFood: (dateId: string, food: Omit<LoggedFoodItem, 'id'>) => void;
  addMultipleFoods: (dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => void;
  updateFood: (dateId: string, foodId: string, updated: Partial<MealLogEditableFields>) => void;
  deleteFood: (dateId: string, foodId: string) => void;
  deleteMultipleFoods: (dateId: string, foodIds: string[]) => void;
  moveMultipleFoodsTime: (dateId: string, foodIds: string[], newTime: string) => void;
  replaceMealDocuments: (documents: MealLogDoc[]) => void;
}

const MealStoreContext = createContext<MealStoreContextType | undefined>(undefined);

export const MealStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const namespace = user ? authDataNamespace(API_BASE_URL, user.id) : 'guest';
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const currentNamespace = useRef(namespace);
  currentNamespace.current = namespace;
  const [logs, setLogs] = useState<MealLogDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLogs([]);
    const ready = (async () => {
      if (namespace === 'guest') await recoverGuestImport().catch(() => null);
      const raw = await storage.getItem(collectionStorageKey(namespace, 'mealLogs'));
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setLogs(parsed.filter(isMealLogDoc));
      } catch {
        // Ignore corrupt cache; PostgreSQL is authoritative after reconnect.
      }
    })();
    readyRef.current = ready;
    const unregister = syncClient.registerCollection('mealLogs', {
      onDocuments: (documents) => {
        if (cancelled) return;
        setLogs((previous) => {
          const next = mergeLogs(previous, documents);
          persistLogs(namespace, next);
          return next;
        });
      },
      onPushConflicts: (documents) => {
        if (!documents.length) return;
        setLogs((previous) => {
          const next = mergeLogs(previous, documents);
          persistLogs(namespace, next);
          return next;
        });
      },
      onPushRejected: (rejections) => {
        const rejectedIds = new Set(
          rejections.filter((value) => isMealLogDoc(value.document)).map((value) => value.document.id)
        );
        if (!rejectedIds.size) return;
        setLogs((previous) => {
          const next = previous.filter((doc) => !rejectedIds.has(doc.id));
          persistLogs(namespace, next);
          return next;
        });
        void syncClient.resetCollection('mealLogs');
      },
    }, ready);
    return () => {
      cancelled = true;
      unregister();
    };
  }, [namespace]);

  const replaceLogs = useCallback((next: MealLogDoc[]) => {
    setLogs(next);
    persistLogs(namespace, next);
    return next;
  }, [namespace]);

  // Outbox persistence owns durability; only acknowledge the native editor
  // after enqueue succeeds. Never publish a late save into a different account.
  const registerMealLog = useCallback(async (document: MealLogDoc) => {
    if (!isMealLogDoc(document) || document._deleted) throw new Error('INVALID_MEAL_LOG');
    if (currentNamespace.current !== namespace) throw new Error('STALE_ACCOUNT');
    await readyRef.current;
    if (currentNamespace.current !== namespace) throw new Error('STALE_ACCOUNT');
    await syncClient.enqueue('mealLogs', document);
    if (currentNamespace.current !== namespace) return;
    setLogs((previous) => {
      const next = mergeLogs(previous, [document]);
      persistLogs(namespace, next);
      return next;
    });
  }, [namespace]);

  const addFood = useCallback((dateId: string, food: Omit<LoggedFoodItem, 'id'>) => {
    const doc = docFromFood(dateId, food, uuid());
    if (!doc) return;
    setLogs((previous) => {
      const next = mergeLogs(previous, [doc]);
      persistLogs(namespace, next);
      return next;
    });
    void syncClient.enqueue('mealLogs', doc);
  }, [namespace]);

  const addMultipleFoods = useCallback((dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => {
    if (!foods.length) return;
    const docs = foods.map((food) => docFromFood(dateId, food, uuid())).filter((doc): doc is MealLogDoc => doc !== null);
    if (!docs.length) return;
    setLogs((previous) => {
      const next = mergeLogs(previous, docs);
      persistLogs(namespace, next);
      return next;
    });
    for (const doc of docs) void syncClient.enqueue('mealLogs', doc);
  }, [namespace]);

  const updateFood = useCallback((dateId: string, foodId: string, updated: Partial<MealLogEditableFields>) => {
    setLogs((previous) => {
      const current = previous.find((doc) => doc.id === foodId);
      if (!current) return previous;
      const display = logToLoggedFood(current);
      const consumedAt = epochForChileDateTime(dateId, updated.time ?? display.time);
      if (consumedAt === null) return previous;
      const nextDoc = updateMealLogQuantityAndTime(
        current,
        updated.portion ?? display.portion,
        consumedAt,
        Date.now()
      );
      if (!nextDoc) return previous;
      const next = mergeLogs(previous, [nextDoc]);
      persistLogs(namespace, next);
      void syncClient.enqueue('mealLogs', nextDoc);
      return next;
    });
  }, [namespace]);

  const deleteFood = useCallback((dateId: string, foodId: string) => {
    void dateId;
    setLogs((previous) => {
      const current = previous.find((doc) => doc.id === foodId);
      if (!current) return previous;
      const deleted = { ...current, updatedAt: Date.now(), _deleted: true };
      const next = mergeLogs(previous, [deleted]);
      persistLogs(namespace, next);
      void syncClient.enqueue('mealLogs', deleted);
      return next;
    });
  }, [namespace]);

  const deleteMultipleFoods = useCallback((dateId: string, foodIds: string[]) => {
    void dateId;
    const ids = new Set(foodIds);
    setLogs((previous) => {
      const deleted = previous.filter((doc) => ids.has(doc.id)).map((doc) => ({ ...doc, updatedAt: Date.now(), _deleted: true }));
      if (!deleted.length) return previous;
      const next = mergeLogs(previous, deleted);
      persistLogs(namespace, next);
      for (const doc of deleted) void syncClient.enqueue('mealLogs', doc);
      return next;
    });
  }, [namespace]);

  const moveMultipleFoodsTime = useCallback((dateId: string, foodIds: string[], newTime: string) => {
    const ids = new Set(foodIds);
    const consumedAt = epochForChileDateTime(dateId, newTime);
    if (consumedAt === null) return;
    setLogs((previous) => {
      const changed = previous.filter((doc) => ids.has(doc.id) && !doc._deleted).map((doc) => ({
        ...doc,
        consumedAt,
        updatedAt: Date.now(),
      }));
      if (!changed.length) return previous;
      const next = mergeLogs(previous, changed);
      persistLogs(namespace, next);
      for (const doc of changed) void syncClient.enqueue('mealLogs', doc);
      return next;
    });
  }, [namespace]);

  const dayLogs = useMemo(() => {
    const grouped: Record<string, DayLog> = {};
    for (const doc of logs) {
      if (doc._deleted) continue;
      const dateId = toDateId(new Date(doc.consumedAt));
      const day = grouped[dateId] ?? emptyDayLog(dateId);
      day.foods.push(logToLoggedFood(doc));
      grouped[dateId] = day;
    }
    return grouped;
  }, [logs]);

  const replaceMealDocuments = useCallback((documents: MealLogDoc[]) => {
    setLogs(documents);
  }, []);
  const value = useMemo<MealStoreContextType>(() => ({
    dayLogs,
    mealDocuments: logs,
    registerMealLog,
    addFood,
    addMultipleFoods,
    updateFood,
    deleteFood,
    deleteMultipleFoods,
    moveMultipleFoodsTime,
    replaceMealDocuments,
  }), [dayLogs, logs, registerMealLog, addFood, addMultipleFoods, updateFood, deleteFood, deleteMultipleFoods, moveMultipleFoodsTime, replaceMealDocuments]);
  return <MealStoreContext.Provider value={value}>{children}</MealStoreContext.Provider>;
};

export const useMealStore = () => {
  const context = useContext(MealStoreContext);
  if (!context) throw new Error('useMealStore debe usarse dentro de un MealStoreProvider');
  return context;
};

export function sumDay(foods: LoggedFoodItem[]) {
  return sumNutrition(foods);
}
