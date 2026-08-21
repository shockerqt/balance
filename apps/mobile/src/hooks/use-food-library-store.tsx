import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './use-auth';
import { storage } from '@/services/storage';
import { collectionStorageKey, syncClient } from '@/services/sync/sync-client';
import { detailsFromLibraryFood, templateToLibraryFood } from '@/services/sync/adapters';
import { MealTemplateDoc, SyncDocument, isMealTemplateDoc } from '@/services/sync/types';
import { fetchOfficialTemplates } from '@/services/sync/official-templates';
import {
  createPersonalTemplate,
  deletePersonalTemplate,
  updatePersonalTemplate,
} from '@/lib/food-library-documents';
import { recoverGuestImport } from '@/services/import/guest-import';

export interface LibraryFoodItem {
  id: string;
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sodiumMg?: number;
  cholesterolMg?: number;
  typicalTime: string;
  frequency: number;
  chileanSeals?: string[];
  category?: string;
  isOfficial?: boolean;
  updatedAt?: number;
}

export type LibraryFoodDraft = Omit<
  LibraryFoodItem,
  'id' | 'frequency' | 'isOfficial' | 'updatedAt'
>;

interface FoodLibraryContextType {
  libraryFoods: LibraryFoodItem[];
  templateDocuments: MealTemplateDoc[];
  isLibraryReady: boolean;
  syncNotice: string;
  clearSyncNotice: () => void;
  getSmartRecommendations: (targetTime: string, searchQuery?: string) => LibraryFoodItem[];
  addCustomFood: (food: LibraryFoodDraft) => LibraryFoodItem;
  updateCustomFood: (foodId: string, food: LibraryFoodDraft) => LibraryFoodItem;
  deleteCustomFood: (foodId: string) => void;
  incrementFoodFrequency: (foodId: string) => void;
  replaceTemplateDocuments: (documents: MealTemplateDoc[]) => void;
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
  const [isLibraryReady, setIsLibraryReady] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const templatesRef = useRef<MealTemplateDoc[]>([]);
  const frequenciesRef = useRef<Record<string, number>>({});

  const commitTemplates = useCallback((update: (current: MealTemplateDoc[]) => MealTemplateDoc[]) => {
    const next = update(templatesRef.current);
    templatesRef.current = next;
    setTemplates(next);
    persistTemplates(namespace, next);
    return next;
  }, [namespace]);

  const commitFrequencies = useCallback((update: (current: Record<string, number>) => Record<string, number>) => {
    const next = update(frequenciesRef.current);
    frequenciesRef.current = next;
    setFrequencies(next);
    void storage.setItem(`${FREQUENCY_KEY_PREFIX}${namespace}`, JSON.stringify(next));
    return next;
  }, [namespace]);

  useEffect(() => {
    let cancelled = false;
    templatesRef.current = [];
    frequenciesRef.current = {};
    setTemplates([]);
    setFrequencies({});
    setIsLibraryReady(false);
    setSyncNotice('');

    const ready = (async () => {
      if (namespace === 'guest') await recoverGuestImport().catch(() => null);
      const [rawTemplates, rawFrequencies] = await Promise.all([
        storage.getItem(collectionStorageKey(namespace, 'mealTemplates')),
        storage.getItem(`${FREQUENCY_KEY_PREFIX}${namespace}`),
      ]);
      if (cancelled) return;
      try {
        const parsed = rawTemplates ? JSON.parse(rawTemplates) : [];
        if (Array.isArray(parsed)) {
          const next = parsed.filter(isMealTemplateDoc);
          templatesRef.current = next;
          setTemplates(next);
        }
      } catch {
        // Ignore corrupt cache; a server pull will repopulate it.
      }
      try {
        const parsed = rawFrequencies ? JSON.parse(rawFrequencies) : {};
        if (parsed && typeof parsed === 'object') {
          frequenciesRef.current = parsed;
          setFrequencies(parsed);
        }
      } catch {
        // Frequency is optional presentation metadata.
      }
      if (!user) {
        const official = await fetchOfficialTemplates();
        if (!cancelled && official.length) {
          commitTemplates((previous) => mergeTemplates(previous, official));
        }
      }
      if (!cancelled) setIsLibraryReady(true);
    })();

    const unregister = syncClient.registerCollection('mealTemplates', {
      onDocuments: (documents) => {
        if (cancelled) return;
        commitTemplates((previous) => mergeTemplates(previous, documents));
      },
      onPushConflicts: (documents) => {
        if (cancelled || !documents.length) return;
        commitTemplates((previous) => mergeTemplates(previous, documents));
        setSyncNotice('Otro dispositivo tenía una versión más reciente. Revisa la ficha antes de volver a editar.');
      },
      onPushRejected: (rejections) => {
        if (cancelled || !rejections.length) return;
        commitTemplates((previous) => {
          const byId = new Map(previous.map((doc) => [doc.id, doc]));
          for (const rejection of rejections) {
            if (!isMealTemplateDoc(rejection.document)) continue;
            if (rejection.previousDocument && isMealTemplateDoc(rejection.previousDocument)) {
              byId.set(rejection.document.id, rejection.previousDocument);
            } else {
              byId.delete(rejection.document.id);
            }
          }
          return Array.from(byId.values());
        });
        setSyncNotice('El servidor rechazó un cambio. Se restauró la última versión guardada.');
        void syncClient.resetCollection('mealTemplates');
      },
    }, ready);
    return () => {
      cancelled = true;
      unregister();
    };
  }, [namespace, isGuest, commitTemplates]);

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

  const addCustomFood = useCallback((foodData: LibraryFoodDraft): LibraryFoodItem => {
    const now = Date.now();
    const doc = createPersonalTemplate(uuid(), foodData.name, detailsFromLibraryFood(foodData), now);
    commitTemplates((previous) => mergeTemplates(previous, [doc]));
    commitFrequencies((current) => ({ ...current, [doc.id]: 1 }));
    void syncClient.enqueue('mealTemplates', doc, null);
    return templateToLibraryFood(doc, 1);
  }, [commitFrequencies, commitTemplates]);

  const updateCustomFood = useCallback((foodId: string, foodData: LibraryFoodDraft): LibraryFoodItem => {
    const current = templatesRef.current.find((doc) => doc.id === foodId);
    const editedDetails = detailsFromLibraryFood(foodData);
    const details = current ? {
      ...current.details,
      ...editedDetails,
      nutritionPer100: { ...current.details.nutritionPer100, ...editedDetails.nutritionPer100 },
    } : editedDetails;
    const doc = updatePersonalTemplate(current, foodData.name, details);
    commitTemplates((previous) => mergeTemplates(previous, [doc]));
    void syncClient.enqueue('mealTemplates', doc, current ?? null);
    return templateToLibraryFood(doc, frequenciesRef.current[doc.id] ?? 0);
  }, [commitTemplates]);

  const deleteCustomFood = useCallback((foodId: string) => {
    const current = templatesRef.current.find((doc) => doc.id === foodId);
    const doc = deletePersonalTemplate(current);
    commitTemplates((previous) => mergeTemplates(previous, [doc]));
    void syncClient.enqueue('mealTemplates', doc, current ?? null);
  }, [commitTemplates]);

  const incrementFoodFrequency = useCallback((foodId: string) => {
    commitFrequencies((current) => ({ ...current, [foodId]: (current[foodId] ?? 0) + 1 }));
  }, [commitFrequencies]);

  const clearSyncNotice = useCallback(() => setSyncNotice(''), []);

  const replaceTemplateDocuments = useCallback((documents: MealTemplateDoc[]) => {
    templatesRef.current = documents;
    setTemplates(documents);
  }, []);

  const value = useMemo(() => ({
    libraryFoods,
    templateDocuments: templates,
    isLibraryReady,
    syncNotice,
    clearSyncNotice,
    getSmartRecommendations,
    addCustomFood,
    updateCustomFood,
    deleteCustomFood,
    incrementFoodFrequency,
    replaceTemplateDocuments,
  }), [
    libraryFoods,
    templates,
    isLibraryReady,
    syncNotice,
    clearSyncNotice,
    getSmartRecommendations,
    addCustomFood,
    updateCustomFood,
    deleteCustomFood,
    incrementFoodFrequency,
    replaceTemplateDocuments,
  ]);
  return <FoodLibraryContext.Provider value={value}>{children}</FoodLibraryContext.Provider>;
};

export const useFoodLibraryStore = () => {
  const context = useContext(FoodLibraryContext);
  if (!context) throw new Error('useFoodLibraryStore must be used within a FoodLibraryProvider');
  return context;
};
