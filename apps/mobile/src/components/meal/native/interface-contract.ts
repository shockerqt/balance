import type { DayLog } from '@/hooks/use-meal-store';
import { projectDays } from './daily-log-contract';
import { nutrientFields, decimal } from './food-entry-contract';
import { isDateId, type MealLogDoc, type WeightLogDoc } from '@/services/sync/types';
import { canonicalQuantityForPortion, scaleNutrition } from '@balance/domain';
import { epochForChileDateTime } from '@/lib/dates';

// Shared native/safe-area palette; targets and data remain canonical.
export const interfaceColors = {
  background: '#101820', surface: '#19232c', surfaceRaised: '#23333f',
  text: '#edf3f5', textSecondary: '#a8bac4', border: '#36444f',
  primary: '#86b8d3', onPrimary: '#102531', danger: '#f1a5a0',
};

export function projectInterfaceDays(logs: Record<string, DayLog>, weights: Record<string, WeightLogDoc>, documents: MealLogDoc[]) {
  const days = projectDays(logs, weights);
  const byId = new Map(documents.filter(d => !d._deleted).map(d => [d.id, d]));
  return Object.fromEntries(Object.entries(days).map(([date, day]) => {
    const foods = logs[date]?.foods ?? [];
    const nutrients = foods.map(f => {
      const doc = byId.get(f.id);
      return doc ? scaleNutrition(doc.nutritionSnapshot.nutritionPer100, doc.canonicalQuantity / 100) : f;
    });
    const totals = Object.fromEntries(['calories', 'protein', 'carbs', 'fat'].map(key => [key,
      foods.reduce((sum, food) => sum + food[key as 'calories' | 'protein' | 'carbs' | 'fat'], 0)]));
    const extendedKeys = new Set(nutrients.flatMap(n => Object.keys((n as { extendedNutrition?: Record<string, unknown> }).extendedNutrition ?? {})));
    // Keep core unknowns explicit without sending dozens of empty micronutrient
    // rows per historical day through the native bridge.
    const detailFields = nutrientFields.filter((field, index) => index < 7 || ['sugarsG', 'saturatedFatG'].includes(field.key) || extendedKeys.has(field.key));
    return [date, { ...day, totals, recorded: foods.length > 0,
      weightKg: weights[date] ? weights[date].weightGrams / 1000 : null,
      details: detailFields.map(field => {
        const values = nutrients.map(n => {
          const flat = n as unknown as Record<string, unknown>;
          const extended = flat.extendedNutrition as Record<string, unknown> | undefined;
          const value = flat[field.key] ?? extended?.[field.key];
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }).filter((n): n is number => n !== null);
        return { label: field.label, unit: field.unit, value: values.length ? values.reduce((a,b) => a+b,0) : null,
          partial: values.length > 0 && values.length < foods.length };
      }),
      foods: day.foods.map(food => {
        const source = foods.find(f => f.id === food.id)!;
        const doc = byId.get(food.id);
        return { ...food, totals: { calories: source.calories, protein: source.protein, carbs: source.carbs, fat: source.fat },
          revision: doc?.updatedAt, unit: doc?.nutritionSnapshot.canonicalUnit,
          canonicalQuantity: doc?.canonicalQuantity, quantity: doc?.entry.enteredQuantity,
          portionSnapshot: doc?.entry.portionSnapshot ?? null };
      }),
    }];
  }));
}

export type InterfaceEvent = {
  session: string; sequence: number; commandRevision: number; date: string;
  action: 'weight-save' | 'weight-delete' | 'preference' | 'edit-save' | 'library' | 'settings' | 'import' | 'register';
  ids?: string[]; time?: string; input?: { quantity?: string; mode?: string; revision?: number; enabled?: boolean };
};

export function weightGrams(value: unknown): number | null {
  const n = decimal(value, true);
  if (n === null || n < 1 || n > 500) return null;
  const grams = Math.round(n * 1000);
  return Math.abs(grams - n * 1000) < 1e-6 && grams % 100 === 0 ? grams : null;
}

export function acceptInterfaceEvent(value: unknown, session: string, sequence: number, revision: number, today: string, documents: MealLogDoc[]): value is InterfaceEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as InterfaceEvent;
  if (e.session !== session || !Number.isSafeInteger(e.sequence) || e.sequence <= sequence || e.commandRevision !== revision || !isDateId(e.date)) return false;
  if (['library', 'settings', 'import', 'register'].includes(e.action)) return true;
  if (e.action === 'preference') return typeof e.input?.enabled === 'boolean';
  if (e.action === 'weight-delete') return e.date <= today;
  if (e.action === 'weight-save') return e.date <= today && weightGrams(e.input?.quantity) !== null;
  if (e.action !== 'edit-save' || !Array.isArray(e.ids) || e.ids.length !== 1 || typeof e.time !== 'string') return false;
  const doc = documents.find(d => d.id === e.ids![0] && !d._deleted);
  if (!doc || e.input?.revision !== doc.updatedAt || epochForChileDateTime(e.date, e.time) === null) return false;
  const quantity = decimal(e.input?.quantity, true);
  if (quantity === null || !(e.input.mode === 'canonical' || (e.input.mode === 'portion' && !!doc.entry.portionSnapshot))) return false;
  const canonical = canonicalQuantityForPortion(quantity, e.input.mode === 'portion' ? doc.entry.portionSnapshot : undefined);
  if (canonical === null) return false;
  const scaled = scaleNutrition(doc.nutritionSnapshot.nutritionPer100, canonical / 100);
  return Object.values(scaled).flatMap(v => typeof v === 'object' && v ? Object.values(v) : [v]).every(v => v == null || (typeof v === 'number' && Number.isFinite(v)));
}
