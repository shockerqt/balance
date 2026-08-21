import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { storage } from '@/services/storage';
import { useAuth } from './use-auth';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { logToLoggedFood, snapshotFromDisplayFood } from '@/services/sync/adapters';
import { MealLogDoc, NutritionSnapshot, SyncDocument, isMealLogDoc } from '@/services/sync/types';
import { resolveMealLogPortion } from '@/lib/food-portions';
import { parsePortion } from '@/lib/portion';
import { sumNutrition } from '@/lib/nutrition';
import { recoverGuestImport } from '@/services/import/guest-import';

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

export interface DayTargets {
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
  targetFiber: number;
}

export interface DayLog extends DayTargets {
  dateId: string;
  displayDate: string;
  foods: LoggedFoodItem[];
}

export const DEFAULT_TARGETS: DayTargets = {
  targetCalories: 2200,
  targetProtein: 150,
  targetCarbs: 220,
  targetFat: 65,
  targetFiber: 30,
};

const CHILE_TIME_ZONE = 'America/Santiago';

function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chileDateParts(epochMs: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

/** All user-facing day boundaries use Chile, independent of device timezone. */
export function toDateId(date: Date): string {
  const p = chileDateParts(date.getTime());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayId(): string {
  return toDateId(new Date());
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function displayDateFor(dateId: string): string {
  const [year, month, day] = dateId.split('-').map(Number);
  if (!year || !month || !day) return dateId;
  // Noon UTC avoids the Chile midnight transition for display-only dates.
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const chile = chileDateParts(date.getTime());
  const weekday = new Date(Date.UTC(chile.year, chile.month - 1, chile.day, 12)).getUTCDay();
  return `${dateId === todayId() ? 'Hoy, ' : ''}${DAY_NAMES[weekday]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

export function emptyDayLog(dateId: string): DayLog {
  return { dateId, displayDate: displayDateFor(dateId), ...DEFAULT_TARGETS, foods: [] };
}

function chileOffsetAt(epochMs: number): number {
  const p = chileDateParts(epochMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epochMs;
}

function epochForChileDateTime(dateId: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = dateId.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  if (dateOnly.getUTCFullYear() !== year || dateOnly.getUTCMonth() !== month - 1 || dateOnly.getUTCDate() !== day) return null;
  const desired = Date.UTC(year, month - 1, day, Number.isFinite(hour) ? hour : 12, Number.isFinite(minute) ? minute : 0);
  let epoch = desired - chileOffsetAt(desired);
  epoch = desired - chileOffsetAt(epoch);
  const resolved = chileDateParts(epoch);
  if (resolved.year !== year || resolved.month !== month || resolved.day !== day || resolved.hour !== hour || resolved.minute !== minute) return null;
  return epoch;
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
  selectedDateId: string;
  setSelectedDateId: (dateId: string) => void;
  dayLogs: Record<string, DayLog>;
  currentDayLog: DayLog;
  mealDocuments: MealLogDoc[];
  addFood: (dateId: string, food: Omit<LoggedFoodItem, 'id'>) => void;
  addMultipleFoods: (dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => void;
  updateFood: (dateId: string, foodId: string, updated: Partial<LoggedFoodItem>) => void;
  deleteFood: (dateId: string, foodId: string) => void;
  deleteMultipleFoods: (dateId: string, foodIds: string[]) => void;
  moveMultipleFoodsTime: (dateId: string, foodIds: string[], newTime: string) => void;
  replaceMealDocuments: (documents: MealLogDoc[]) => void;
}

const MealStoreContext = createContext<MealStoreContextType | undefined>(undefined);

export const MealStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const namespace = user ? `user:${user.id}` : 'guest';
  const [selectedDateId, setSelectedDateId] = useState(todayId);
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

  const updateFood = useCallback((dateId: string, foodId: string, updated: Partial<LoggedFoodItem>) => {
    setLogs((previous) => {
      const current = previous.find((doc) => doc.id === foodId);
      if (!current) return previous;
      const display = logToLoggedFood(current);
      const merged = { ...display, ...updated, id: foodId };
      const consumedAt = epochForChileDateTime(dateId, merged.time);
      if (consumedAt === null) return previous;
      const resolvedPortion = resolveMealLogPortion(current, merged.portion);
      if (!resolvedPortion) return previous;

      const nutritionChanged =
        (updated.calories !== undefined && updated.calories !== display.calories) ||
        (updated.protein !== undefined && updated.protein !== display.protein) ||
        (updated.carbs !== undefined && updated.carbs !== display.carbs) ||
        (updated.fat !== undefined && updated.fat !== display.fat) ||
        (updated.fiber !== undefined && updated.fiber !== display.fiber);
      let nutritionSnapshot = current.nutritionSnapshot;
      if (nutritionChanged) {
        try {
          nutritionSnapshot = snapshotFromDisplayFood({
            ...merged,
            portion: `${resolvedPortion.canonicalQuantity}${current.nutritionSnapshot.canonicalUnit}`,
          });
        } catch {
          return previous;
        }
      }

      const nextDoc: MealLogDoc = {
        ...current,
        nameSnapshot: merged.name,
        nutritionSnapshot,
        canonicalQuantity: resolvedPortion.canonicalQuantity,
        entry: resolvedPortion.entry,
        consumedAt,
        updatedAt: Date.now(),
      };
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

  const currentDayLog = useMemo(() => dayLogs[selectedDateId] ?? emptyDayLog(selectedDateId), [dayLogs, selectedDateId]);
  const replaceMealDocuments = useCallback((documents: MealLogDoc[]) => {
    setLogs(documents);
  }, []);
  const value = useMemo<MealStoreContextType>(() => ({
    selectedDateId,
    setSelectedDateId,
    dayLogs,
    currentDayLog,
    mealDocuments: logs,
    addFood,
    addMultipleFoods,
    updateFood,
    deleteFood,
    deleteMultipleFoods,
    moveMultipleFoodsTime,
    replaceMealDocuments,
  }), [selectedDateId, dayLogs, currentDayLog, logs, addFood, addMultipleFoods, updateFood, deleteFood, deleteMultipleFoods, moveMultipleFoodsTime, replaceMealDocuments]);
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
