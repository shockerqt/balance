import React, { createContext, useContext, useState, useEffect } from 'react';

export interface LoggedFoodItem {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  time: string; // "HH:MM" format e.g. "08:30"
  chileanSeals?: string[];
}

export interface DayLog {
  dateId: string; // "YYYY-MM-DD"
  displayDate: string;
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat: number;
  targetFiber: number;
  foods: LoggedFoodItem[];
}

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
  moveFoodTime: (dateId: string, foodId: string, newTime: string) => void;
  moveMultipleFoodsTime: (dateId: string, foodIds: string[], newTime: string) => void;
}

const STORAGE_KEY = '@balance_meal_logs_v1';

// Safe Storage Adapter with fallback
const safeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return await AsyncStorage.getItem(key);
    } catch (e) {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    }
  },
};

const INITIAL_DAY_LOGS: Record<string, DayLog> = {
  '2026-08-02': {
    dateId: '2026-08-02',
    displayDate: 'Hoy, Domingo 2 de Agosto',
    targetCalories: 2200,
    targetProtein: 150,
    targetCarbs: 220,
    targetFat: 65,
    targetFiber: 30,
    foods: [
      {
        id: 'f1',
        name: 'Huevos Revueltos (2 un)',
        portion: '100g',
        calories: 150,
        protein: 12,
        carbs: 1,
        fat: 10,
        fiber: 0,
        time: '08:30',
      },
      {
        id: 'f2',
        name: 'Pan Marraqueta Integral',
        portion: '100g',
        calories: 270,
        protein: 9,
        carbs: 52,
        fat: 2,
        fiber: 4,
        time: '08:30',
      },
      {
        id: 'f3',
        name: 'Café Negro sin Azúcar',
        portion: '200cc',
        calories: 5,
        protein: 0,
        carbs: 1,
        fat: 0,
        fiber: 0,
        time: '08:30',
      },
      {
        id: 'f4',
        name: 'Manzana Fuji',
        portion: '150g',
        calories: 80,
        protein: 0,
        carbs: 21,
        fat: 0,
        fiber: 3,
        time: '11:15',
      },
      {
        id: 'f5',
        name: 'Pechuga de Pollo Ariztía',
        portion: '200g',
        calories: 330,
        protein: 62,
        carbs: 0,
        fat: 7,
        fiber: 0,
        time: '13:30',
      },
      {
        id: 'f6',
        name: 'Arroz Integral Cocido',
        portion: '250g',
        calories: 275,
        protein: 6,
        carbs: 58,
        fat: 2,
        fiber: 3,
        time: '13:30',
      },
    ],
  },
};

const MealStoreContext = createContext<MealStoreContextType | undefined>(undefined);

export const MealStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedDateId, setSelectedDateId] = useState<string>('2026-08-02');
  const [dayLogs, setDayLogs] = useState<Record<string, DayLog>>(INITIAL_DAY_LOGS);

  useEffect(() => {
    safeStorage.getItem(STORAGE_KEY).then((data: string | null) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          setDayLogs(parsed);
        } catch (e) {
          console.error('Failed to parse meal logs from storage', e);
        }
      }
    });
  }, []);

  const saveLogs = (newLogs: Record<string, DayLog>) => {
    setDayLogs(newLogs);
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(newLogs)).catch((e: unknown) => {
      console.error('Failed to save meal logs to storage', e);
    });
  };

  const currentDayLog = dayLogs[selectedDateId] || {
    dateId: selectedDateId,
    displayDate: selectedDateId,
    targetCalories: 2200,
    targetProtein: 150,
    targetCarbs: 220,
    targetFat: 65,
    targetFiber: 30,
    foods: [],
  };

  const addFood = (dateId: string, foodData: Omit<LoggedFoodItem, 'id'>) => {
    const newFood: LoggedFoodItem = {
      ...foodData,
      id: 'food_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    };

    const existingDay = dayLogs[dateId] || {
      dateId,
      displayDate: dateId,
      targetCalories: 2200,
      targetProtein: 150,
      targetCarbs: 220,
      targetFat: 65,
      targetFiber: 30,
      foods: [],
    };

    const updatedFoods = [...existingDay.foods, newFood];
    const updatedDay = { ...existingDay, foods: updatedFoods };

    saveLogs({ ...dayLogs, [dateId]: updatedDay });
  };

  const addMultipleFoods = (dateId: string, foodsData: Omit<LoggedFoodItem, 'id'>[]) => {
    if (!foodsData || foodsData.length === 0) return;

    const newFoods: LoggedFoodItem[] = foodsData.map((foodData, idx) => ({
      ...foodData,
      id: 'food_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 7),
    }));

    const existingDay = dayLogs[dateId] || {
      dateId,
      displayDate: dateId,
      targetCalories: 2200,
      targetProtein: 150,
      targetCarbs: 220,
      targetFat: 65,
      targetFiber: 30,
      foods: [],
    };

    const updatedFoods = [...existingDay.foods, ...newFoods];
    const updatedDay = { ...existingDay, foods: updatedFoods };

    saveLogs({ ...dayLogs, [dateId]: updatedDay });
  };

  const updateFood = (dateId: string, foodId: string, updated: Partial<LoggedFoodItem>) => {
    const existingDay = dayLogs[dateId];
    if (!existingDay) return;

    const updatedFoods = existingDay.foods.map((f) =>
      f.id === foodId ? { ...f, ...updated } : f
    );

    saveLogs({ ...dayLogs, [dateId]: { ...existingDay, foods: updatedFoods } });
  };

  const deleteFood = (dateId: string, foodId: string) => {
    const existingDay = dayLogs[dateId];
    if (!existingDay) return;

    const updatedFoods = existingDay.foods.filter((f) => f.id !== foodId);
    saveLogs({ ...dayLogs, [dateId]: { ...existingDay, foods: updatedFoods } });
  };

  const deleteMultipleFoods = (dateId: string, foodIds: string[]) => {
    const existingDay = dayLogs[dateId];
    if (!existingDay) return;

    const idSet = new Set(foodIds);
    const updatedFoods = existingDay.foods.filter((f) => !idSet.has(f.id));
    saveLogs({ ...dayLogs, [dateId]: { ...existingDay, foods: updatedFoods } });
  };

  const moveFoodTime = (dateId: string, foodId: string, newTime: string) => {
    updateFood(dateId, foodId, { time: newTime });
  };

  const moveMultipleFoodsTime = (dateId: string, foodIds: string[], newTime: string) => {
    const existingDay = dayLogs[dateId];
    if (!existingDay) return;

    const idSet = new Set(foodIds);
    const updatedFoods = existingDay.foods.map((f) =>
      idSet.has(f.id) ? { ...f, time: newTime } : f
    );
    saveLogs({ ...dayLogs, [dateId]: { ...existingDay, foods: updatedFoods } });
  };

  return (
    <MealStoreContext.Provider
      value={{
        selectedDateId,
        setSelectedDateId,
        dayLogs,
        currentDayLog,
        addFood,
        addMultipleFoods,
        updateFood,
        deleteFood,
        deleteMultipleFoods,
        moveFoodTime,
        moveMultipleFoodsTime,
      }}>
      {children}
    </MealStoreContext.Provider>
  );
};

export const useMealStore = () => {
  const context = useContext(MealStoreContext);
  if (!context) {
    throw new Error('useMealStore must be used within a MealStoreProvider');
  }
  return context;
};
