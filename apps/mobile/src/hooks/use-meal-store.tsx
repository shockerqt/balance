import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { storage } from '@/services/storage';

export interface LoggedFoodItem {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  /** "HH:MM" */
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
  /** "YYYY-MM-DD" */
  dateId: string;
  displayDate: string;
  foods: LoggedFoodItem[];
}

/** Objetivos por defecto. Antes este literal estaba escrito cuatro veces. */
export const DEFAULT_TARGETS: DayTargets = {
  targetCalories: 2200,
  targetProtein: 150,
  targetCarbs: 220,
  targetFat: 65,
  targetFiber: 30,
};

const STORAGE_KEY = '@balance_meal_logs_v1';

/** "YYYY-MM-DD" en hora local. `toISOString()` usa UTC y adelanta el dia en Chile. */
export function toDateId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayId(): string {
  return toDateId(new Date());
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function displayDateFor(dateId: string): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  const date = new Date(y, m - 1, d);
  const prefix = dateId === todayId() ? 'Hoy, ' : '';
  return `${prefix}${DAY_NAMES[date.getDay()]} ${d} de ${MONTH_NAMES[m - 1]}`;
}

/** Un dia vacio. Un solo lugar donde viven los valores por defecto. */
export function emptyDayLog(dateId: string): DayLog {
  return {
    dateId,
    displayDate: displayDateFor(dateId),
    ...DEFAULT_TARGETS,
    foods: [],
  };
}

let idCounter = 0;
const nextId = () => `food_${Date.now()}_${idCounter++}_${Math.random().toString(36).slice(2, 7)}`;

interface MealStoreContextType {
  selectedDateId: string;
  setSelectedDateId: (dateId: string) => void;
  dayLogs: Record<string, DayLog>;
  currentDayLog: DayLog;
  addFood: (dateId: string, food: Omit<LoggedFoodItem, 'id'>) => void;
  addMultipleFoods: (dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => void;
  updateFood: (dateId: string, foodId: string, updated: Partial<LoggedFoodItem>) => void;
  deleteFood: (dateId: string, foodId: string) => void;
  deleteMultipleFoods: (dateId: string, foodIds: string[]) => void;
  moveMultipleFoodsTime: (dateId: string, foodIds: string[], newTime: string) => void;
}

const MealStoreContext = createContext<MealStoreContextType | undefined>(undefined);

export const MealStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedDateId, setSelectedDateId] = useState<string>(todayId);
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>({});

  useEffect(() => {
    let cancelled = false;
    storage
      .getItem(STORAGE_KEY)
      .then((data) => {
        if (cancelled || !data) return;
        try {
          setDayLogs(JSON.parse(data));
        } catch (e) {
          console.error('No se pudo leer el registro guardado', e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Toda mutacion pasa por aqui con la forma funcional de setState: dos
   * operaciones en el mismo tick ya no se pisan, como ocurria al
   * construir el nuevo estado desde el `dayLogs` capturado en el closure.
   */
  const mutate = useCallback((dateId: string, fn: (day: DayLog) => DayLog) => {
    setDayLogs((prev) => {
      const next = { ...prev, [dateId]: fn(prev[dateId] ?? emptyDayLog(dateId)) };
      storage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((e: unknown) => {
        console.error('No se pudo guardar el registro', e);
      });
      return next;
    });
  }, []);

  const addFood = useCallback(
    (dateId: string, food: Omit<LoggedFoodItem, 'id'>) =>
      mutate(dateId, (day) => ({ ...day, foods: [...day.foods, { ...food, id: nextId() }] })),
    [mutate]
  );

  const addMultipleFoods = useCallback(
    (dateId: string, foods: Omit<LoggedFoodItem, 'id'>[]) => {
      if (!foods?.length) return;
      mutate(dateId, (day) => ({
        ...day,
        foods: [...day.foods, ...foods.map((f) => ({ ...f, id: nextId() }))],
      }));
    },
    [mutate]
  );

  const updateFood = useCallback(
    (dateId: string, foodId: string, updated: Partial<LoggedFoodItem>) =>
      mutate(dateId, (day) => ({
        ...day,
        foods: day.foods.map((f) => (f.id === foodId ? { ...f, ...updated } : f)),
      })),
    [mutate]
  );

  const deleteFood = useCallback(
    (dateId: string, foodId: string) =>
      mutate(dateId, (day) => ({ ...day, foods: day.foods.filter((f) => f.id !== foodId) })),
    [mutate]
  );

  const deleteMultipleFoods = useCallback(
    (dateId: string, foodIds: string[]) => {
      const ids = new Set(foodIds);
      mutate(dateId, (day) => ({ ...day, foods: day.foods.filter((f) => !ids.has(f.id)) }));
    },
    [mutate]
  );


  const moveMultipleFoodsTime = useCallback(
    (dateId: string, foodIds: string[], newTime: string) => {
      const ids = new Set(foodIds);
      mutate(dateId, (day) => ({
        ...day,
        foods: day.foods.map((f) => (ids.has(f.id) ? { ...f, time: newTime } : f)),
      }));
    },
    [mutate]
  );

  const currentDayLog = useMemo(
    () => dayLogs[selectedDateId] ?? emptyDayLog(selectedDateId),
    [dayLogs, selectedDateId]
  );

  const value = useMemo<MealStoreContextType>(
    () => ({
      selectedDateId,
      setSelectedDateId,
      dayLogs,
      currentDayLog,
      addFood,
      addMultipleFoods,
      updateFood,
      deleteFood,
      deleteMultipleFoods,
      moveMultipleFoodsTime,
    }),
    [
      selectedDateId,
      dayLogs,
      currentDayLog,
      addFood,
      addMultipleFoods,
      updateFood,
      deleteFood,
      deleteMultipleFoods,
      moveMultipleFoodsTime,
    ]
  );

  return <MealStoreContext.Provider value={value}>{children}</MealStoreContext.Provider>;
};

export const useMealStore = () => {
  const context = useContext(MealStoreContext);
  if (!context) throw new Error('useMealStore debe usarse dentro de un MealStoreProvider');
  return context;
};

/** Totales del dia. Estaban recalculados a mano en cada pantalla. */
export function sumDay(foods: LoggedFoodItem[]) {
  return foods.reduce(
    (acc, f) => ({
      calories: acc.calories + (f.calories || 0),
      protein: acc.protein + (f.protein || 0),
      carbs: acc.carbs + (f.carbs || 0),
      fat: acc.fat + (f.fat || 0),
      fiber: acc.fiber + (f.fiber || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}
