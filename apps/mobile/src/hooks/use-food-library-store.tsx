import React, { createContext, useContext, useState, useEffect } from 'react';
import { storage } from '@/services/storage';

export interface LibraryFoodItem {
  id: string;
  name: string;
  portion: string; // e.g. "100g" or "1 unidad"
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  typicalTime: string; // "HH:MM" e.g. "08:30"
  frequency: number; // Log count
  chileanSeals?: string[]; // e.g. ['ALTO EN CALORÍAS', 'ALTO EN SODIO']
  category?: string; // e.g. "Desayuno", "Proteínas", "Carbohidratos", "Frutas"
}

interface FoodLibraryContextType {
  libraryFoods: LibraryFoodItem[];
  getSmartRecommendations: (targetTime: string, searchQuery?: string) => LibraryFoodItem[];
  addCustomFood: (food: Omit<LibraryFoodItem, 'id' | 'frequency'>) => LibraryFoodItem;
  incrementFoodFrequency: (foodId: string) => void;
}

const STORAGE_KEY = '@balance_food_library_v1';

const INITIAL_LIBRARY_FOODS: LibraryFoodItem[] = [
  {
    id: 'lib_1',
    name: 'Huevos Revueltos (2 un)',
    portion: '100g',
    calories: 150,
    protein: 12,
    carbs: 1,
    fat: 10,
    fiber: 0,
    typicalTime: '08:30',
    frequency: 18,
    category: 'Desayuno',
  },
  {
    id: 'lib_2',
    name: 'Pan Marraqueta Integral',
    portion: '100g',
    calories: 270,
    protein: 9,
    carbs: 52,
    fat: 2,
    fiber: 4,
    typicalTime: '08:30',
    frequency: 24,
    category: 'Desayuno',
  },
  {
    id: 'lib_3',
    name: 'Café Negro sin Azúcar',
    portion: '200cc',
    calories: 5,
    protein: 0,
    carbs: 1,
    fat: 0,
    fiber: 0,
    typicalTime: '08:30',
    frequency: 30,
    category: 'Desayuno',
  },
  {
    id: 'lib_4',
    name: 'Avena Cereal en Hojuelas',
    portion: '50g',
    calories: 190,
    protein: 7,
    carbs: 33,
    fat: 3,
    fiber: 5,
    typicalTime: '08:30',
    frequency: 12,
    category: 'Desayuno',
  },
  {
    id: 'lib_5',
    name: 'Manzana Fuji Fresca',
    portion: '150g',
    calories: 80,
    protein: 0,
    carbs: 21,
    fat: 0,
    fiber: 3,
    typicalTime: '11:00',
    frequency: 15,
    category: 'Frutas',
  },
  {
    id: 'lib_6',
    name: 'Pechuga de Pollo a la Plancha',
    portion: '200g',
    calories: 330,
    protein: 62,
    carbs: 0,
    fat: 7,
    fiber: 0,
    typicalTime: '13:30',
    frequency: 22,
    chileanSeals: [],
    category: 'Proteínas',
  },
  {
    id: 'lib_7',
    name: 'Arroz Integral Cocido',
    portion: '250g',
    calories: 275,
    protein: 6,
    carbs: 58,
    fat: 2,
    fiber: 3,
    typicalTime: '13:30',
    frequency: 20,
    category: 'Carbohidratos',
  },
  {
    id: 'lib_8',
    name: 'Palta Hass Fileteada',
    portion: '80g',
    calories: 130,
    protein: 2,
    carbs: 7,
    fat: 12,
    fiber: 5,
    typicalTime: '08:30',
    frequency: 16,
    category: 'Grasas Saludables',
  },
  {
    id: 'lib_9',
    name: 'Yogurt Protein Vainilla',
    portion: '150g',
    calories: 110,
    protein: 14,
    carbs: 10,
    fat: 1,
    fiber: 0,
    typicalTime: '17:00',
    frequency: 14,
    chileanSeals: ['ALTO EN AZÚCARES'],
    category: 'Snacks',
  },
  {
    id: 'lib_10',
    name: 'Filete de Salmón al Horno',
    portion: '200g',
    calories: 410,
    protein: 40,
    carbs: 0,
    fat: 27,
    fiber: 0,
    typicalTime: '20:30',
    frequency: 9,
    category: 'Proteínas',
  },
];

// Helper to convert "HH:MM" to total minutes from midnight
const timeToMinutes = (timeStr: string): number => {
  const parts = timeStr.split(':');
  if (parts.length === 2) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
  }
  return 720; // 12:00 default
};

const FoodLibraryContext = createContext<FoodLibraryContextType | undefined>(undefined);

export const FoodLibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [libraryFoods, setLibraryFoods] = useState<LibraryFoodItem[]>(INITIAL_LIBRARY_FOODS);

  useEffect(() => {
    storage.getItem(STORAGE_KEY).then((data: string | null) => {
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setLibraryFoods(parsed);
          }
        } catch (e) {
          console.error('Failed to parse food library from storage', e);
        }
      }
    });
  }, []);

  const saveLibrary = (newLibrary: LibraryFoodItem[]) => {
    setLibraryFoods(newLibrary);
    storage.setItem(STORAGE_KEY, JSON.stringify(newLibrary)).catch((e: unknown) => {
      console.error('Failed to save food library to storage', e);
    });
  };

  // Smart Ranking Algorithm: Frequency + Time Delta Proximity
  const getSmartRecommendations = (targetTime: string, searchQuery: string = ''): LibraryFoodItem[] => {
    const targetMin = timeToMinutes(targetTime);
    const queryLower = searchQuery.trim().toLowerCase();

    const filtered = libraryFoods.filter((item) => {
      if (!queryLower) return true;
      return (
        item.name.toLowerCase().includes(queryLower) ||
        (item.category && item.category.toLowerCase().includes(queryLower))
      );
    });

    return filtered.sort((a, b) => {
      const deltaA = Math.abs(timeToMinutes(a.typicalTime) - targetMin);
      const deltaB = Math.abs(timeToMinutes(b.typicalTime) - targetMin);

      // Score formula: (frequency + 1) / (1 + deltaHours)
      const scoreA = (a.frequency + 1) / (1 + deltaA / 60);
      const scoreB = (b.frequency + 1) / (1 + deltaB / 60);

      return scoreB - scoreA; // Descending order
    });
  };

  const addCustomFood = (foodData: Omit<LibraryFoodItem, 'id' | 'frequency'>): LibraryFoodItem => {
    const newFood: LibraryFoodItem = {
      ...foodData,
      id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      frequency: 1,
    };

    const updated = [newFood, ...libraryFoods];
    saveLibrary(updated);
    return newFood;
  };

  const incrementFoodFrequency = (foodId: string) => {
    const updated = libraryFoods.map((f) =>
      f.id === foodId ? { ...f, frequency: f.frequency + 1 } : f
    );
    saveLibrary(updated);
  };

  return (
    <FoodLibraryContext.Provider
      value={{
        libraryFoods,
        getSmartRecommendations,
        addCustomFood,
        incrementFoodFrequency,
      }}>
      {children}
    </FoodLibraryContext.Provider>
  );
};

export const useFoodLibraryStore = () => {
  const context = useContext(FoodLibraryContext);
  if (!context) {
    throw new Error('useFoodLibraryStore must be used within a FoodLibraryProvider');
  }
  return context;
};
