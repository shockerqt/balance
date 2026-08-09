import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './use-auth';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { detailsFromLibraryFood, templateToLibraryFood } from '@/services/sync/adapters';
import { MealTemplateDoc, SyncDocument, isMealTemplateDoc } from '@/services/sync/types';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';

export interface LibraryFoodItem {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  typicalTime: string;
  frequency: number;
  chileanSeals?: string[];
  category?: string;
  isOfficial?: boolean;
  updatedAt?: number;
}

interface FoodLibraryContextType {
  libraryFoods: LibraryFoodItem[];
  getSmartRecommendations: (targetTime: string, searchQuery?: string) => LibraryFoodItem[];
  addCustomFood: (food: Omit<LibraryFoodItem, 'id' | 'frequency'>) => LibraryFoodItem;
  incrementFoodFrequency: (foodId: string) => void;
}

const FREQUENCY_KEY_PREFIX = '@balance_food_frequency_v2:';

function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 720;
};

function mergeTemplates(previous: MealTemplateDoc[], incoming: SyncDocument[]): MealTemplateDoc[] {
  const byId = new Map(previous.map((doc) => [doc.id, doc]));
  for (const value of incoming) {
    if (!isMealTemplateDoc(value)) continue;
    const current = byId.get(value.id);
    if (!current || value.updatedAt > current.updatedAt || (value.updatedAt === current.updatedAt && value.id >= current.id)) {
      byId.set(value.id, value);
    }
  }
  return Array.from(byId.values());
}

function persistTemplates(namespace: string, docs: MealTemplateDoc[]): void {
  void storage.setItem(collectionStorageKey(namespace, 'mealTemplates'), JSON.stringify(docs));
}

const FoodLibraryContext = createContext<FoodLibraryContextType | undefined>(undefined);

export const FoodLibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isGuest } = useAuth();
  const namespace = user ? `user:${user.id}` : 'guest';
  const [templates, setTemplates] = useState<MealTemplateDoc[]>([]);
  const [frequencies, setFrequencies] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    setTemplates([]);
    setFrequencies({});

    const ready = (async () => {
      const [rawTemplates, rawFrequencies] = await Promise.all([
        storage.getItem(collectionStorageKey(namespace, 'mealTemplates')),
        storage.getItem(`${FREQUENCY_KEY_PREFIX}${namespace}`),
      ]);
      if (cancelled) return;
      try {
        const parsed = rawTemplates ? JSON.parse(rawTemplates) : [];
        if (Array.isArray(parsed)) setTemplates(parsed.filter(isMealTemplateDoc));
      } catch {
        // Ignore corrupt cache; a server pull will repopulate it.
      }
      try {
        const parsed = rawFrequencies ? JSON.parse(rawFrequencies) : {};
        if (parsed && typeof parsed === 'object') setFrequencies(parsed);
      } catch {
        // Frequency is optional presentation metadata.
      }
      if (!user) {
        const official = await fetchOfficialTemplates();
        if (cancelled || !official.length) return;
        setTemplates((previous) => {
          const next = mergeTemplates(previous, official);
          persistTemplates(namespace, next);
          return next;
        });
      }
    })();

    const unregister = syncClient.registerCollection('mealTemplates', {
      onDocuments: (documents) => {
        if (cancelled) return;
        setTemplates((previous) => {
          const next = mergeTemplates(previous, documents);
          persistTemplates(namespace, next);
          return next;
        });
      },
      onPushConflicts: (documents) => {
        if (!documents.length) return;
        setTemplates((previous) => {
          const next = mergeTemplates(previous, documents);
          persistTemplates(namespace, next);
          return next;
        });
      },
      onPushRejected: (rejections) => {
        const rejectedIds = new Set(
          rejections
            .filter((value) => isMealTemplateDoc(value.document))
            .map((value) => value.document.id)
        );
        if (!rejectedIds.size) return;
        setTemplates((previous) => {
          const next = previous.filter((doc) => !rejectedIds.has(doc.id));
          persistTemplates(namespace, next);
          return next;
        });
        void syncClient.resetCollection('mealTemplates');
      },
    }, ready);
    return () => {
      cancelled = true;
      unregister();
    };
  }, [namespace, isGuest]);

  const saveFrequencies = useCallback((next: Record<string, number>) => {
    setFrequencies(next);
    void storage.setItem(`${FREQUENCY_KEY_PREFIX}${namespace}`, JSON.stringify(next));
  }, [namespace]);

  const libraryFoods = useMemo(
    () => templates
      .filter((doc) => !doc._deleted)
      .map((doc) => templateToLibraryFood(doc, frequencies[doc.id] ?? 0)),
    [templates, frequencies]
  );

  const getSmartRecommendations = useCallback((targetTime: string, searchQuery = '') => {
    const targetMinutes = timeToMinutes(targetTime);
    const query = searchQuery.trim().toLowerCase();
    return libraryFoods
      .filter((food) => !query || food.name.toLowerCase().includes(query) || food.category?.toLowerCase().includes(query))
      .slice()
      .sort((a, b) => {
        const score = (food: LibraryFoodItem) => (food.frequency + 1) / (1 + Math.abs(timeToMinutes(food.typicalTime) - targetMinutes) / 60);
        return score(b) - score(a);
      });
  }, [libraryFoods]);

  const addCustomFood = useCallback((foodData: Omit<LibraryFoodItem, 'id' | 'frequency'>): LibraryFoodItem => {
    const now = Date.now();
    const doc: MealTemplateDoc = {
      id: uuid(),
      name: foodData.name.trim(),
      isOfficial: false,
      details: detailsFromLibraryFood(foodData),
      updatedAt: now,
      _deleted: false,
    };
    setTemplates((previous) => {
      const next = mergeTemplates(previous, [doc]);
      persistTemplates(namespace, next);
      return next;
    });
    const nextFrequencies = { ...frequencies, [doc.id]: 1 };
    saveFrequencies(nextFrequencies);
    void syncClient.enqueue('mealTemplates', doc);
    return templateToLibraryFood(doc, 1);
  }, [frequencies, namespace, saveFrequencies]);

  const incrementFoodFrequency = useCallback((foodId: string) => {
    saveFrequencies({ ...frequencies, [foodId]: (frequencies[foodId] ?? 0) + 1 });
  }, [frequencies, saveFrequencies]);

  const value = useMemo(() => ({ libraryFoods, getSmartRecommendations, addCustomFood, incrementFoodFrequency }), [
    libraryFoods,
    getSmartRecommendations,
    addCustomFood,
    incrementFoodFrequency,
  ]);
  return <FoodLibraryContext.Provider value={value}>{children}</FoodLibraryContext.Provider>;
};

export const useFoodLibraryStore = () => {
  const context = useContext(FoodLibraryContext);
  if (!context) throw new Error('useFoodLibraryStore must be used within a FoodLibraryProvider');
  return context;
};
