import type { MealLogDoc } from '../../../types/meal-log.ts';

const STORAGE_KEY = 'balance.dashboard.meal-logs.v1';

export interface FoodLogStorage {
  load(): MealLogDoc[] | null;
  save(documents: MealLogDoc[]): void;
}

function looksLikeMealLog(value: unknown): value is MealLogDoc {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === 'string' &&
    typeof document.nameSnapshot === 'string' &&
    typeof document.quantity === 'number' &&
    typeof document.consumedAt === 'number' &&
    typeof document.updatedAt === 'number' &&
    typeof document._deleted === 'boolean' &&
    !!document.nutritionSnapshot &&
    typeof document.nutritionSnapshot === 'object'
  );
}

export const browserFoodLogStorage: FoodLogStorage = {
  load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(looksLikeMealLog);
    } catch {
      return null;
    }
  },
  save(documents) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
    } catch {
      // Local persistence is best-effort until the dashboard sync client is wired.
    }
  },
};
