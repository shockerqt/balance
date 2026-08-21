import type { MealLogDoc, NutritionSnapshot, MealLogEntry } from '../../../types/meal-log.ts';
import { timeInChile, toDateId } from './time.ts';

export type FoodLogMode = 'normal' | 'visual';
export type RegisterSource = 'yank' | 'delete' | 'visual-paste';

export interface FoodLogRegisterItem {
  templateId: string | null;
  nameSnapshot: string;
  nutritionSnapshot: NutritionSnapshot;
  provenance?: MealLogDoc['provenance'];
  canonicalQuantity: number;
  entry: MealLogEntry;
  consumedAt: number;
}

export interface FoodLogRegister {
  items: FoodLogRegisterItem[];
  source: RegisterSource;
}

export interface FoodLogSnapshot {
  documents: MealLogDoc[];
  selectedDateId: string;
  cursorId: string | null;
  selectionAnchorId: string | null;
  mode: FoodLogMode;
}

export interface FoodLogState extends FoodLogSnapshot {
  register: FoodLogRegister | null;
  history: FoodLogSnapshot[];
  future: FoodLogSnapshot[];
  lastChange: import('../commands/command.ts').FoodLogCommand | null;
}

export interface DisplayNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DisplayFoodRow {
  document: MealLogDoc;
  time: string;
  quantityLabel: string;
  nutrition: DisplayNutrition;
}

export function createSnapshot(state: FoodLogState): FoodLogSnapshot {
  return {
    documents: state.documents.map((document) => ({ ...document })),
    selectedDateId: state.selectedDateId,
    cursorId: state.cursorId,
    selectionAnchorId: state.selectionAnchorId,
    mode: state.mode,
  };
}

export function restoreSnapshot(state: FoodLogState, snapshot: FoodLogSnapshot): FoodLogState {
  return {
    ...state,
    ...snapshot,
    documents: snapshot.documents.map((document) => ({ ...document })),
  };
}

export function documentsForSelectedDay(state: FoodLogState): MealLogDoc[] {
  return state.documents
    .filter((document) => !document._deleted && toDateId(document.consumedAt) === state.selectedDateId)
    .sort((left, right) => {
      if (left.consumedAt !== right.consumedAt) return left.consumedAt - right.consumedAt;
      if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
      return left.id.localeCompare(right.id);
    });
}

export function ensureCursor(state: FoodLogState): FoodLogState {
  const rows = documentsForSelectedDay(state);
  if (!rows.length) {
    return { ...state, cursorId: null, selectionAnchorId: null, mode: 'normal' };
  }
  if (state.cursorId && rows.some((row) => row.id === state.cursorId)) return state;
  return { ...state, cursorId: rows[0].id };
}

export function cursorIndex(state: FoodLogState): number {
  if (!state.cursorId) return -1;
  return documentsForSelectedDay(state).findIndex((row) => row.id === state.cursorId);
}

export function selectedRowIds(state: FoodLogState): string[] {
  const rows = documentsForSelectedDay(state);
  const cursor = cursorIndex(state);
  if (cursor < 0) return [];
  if (state.mode !== 'visual' || !state.selectionAnchorId) return [rows[cursor].id];
  const anchor = rows.findIndex((row) => row.id === state.selectionAnchorId);
  if (anchor < 0) return [rows[cursor].id];
  const from = Math.min(anchor, cursor);
  const to = Math.max(anchor, cursor);
  return rows.slice(from, to + 1).map((row) => row.id);
}

export function registerItemFromDocument(document: MealLogDoc): FoodLogRegisterItem {
  return {
    templateId: document.templateId,
    nameSnapshot: document.nameSnapshot,
    nutritionSnapshot: structuredClone(document.nutritionSnapshot),
    ...(document.provenance === undefined ? {} : { provenance: document.provenance }),
    canonicalQuantity: document.canonicalQuantity,
    entry: structuredClone(document.entry),
    consumedAt: document.consumedAt,
  };
}

export function nutritionForDocument(document: MealLogDoc): DisplayNutrition {
  const nutrition = document.nutritionSnapshot.nutritionPer100;
  const factor = document.canonicalQuantity / 100;
  return {
    calories: nutrition.calories * factor,
    protein: nutrition.protein * factor,
    carbs: nutrition.carbs * factor,
    fat: nutrition.fat * factor,
  };
}

export function displayRow(document: MealLogDoc): DisplayFoodRow {
  const portion = document.entry.portionSnapshot;
  return {
    document,
    time: timeInChile(document.consumedAt),
    quantityLabel: portion
      ? `${formatNumber(document.entry.enteredQuantity)} ${portion.name}`
      : `${formatNumber(document.canonicalQuantity)} ${document.nutritionSnapshot.canonicalUnit}`,
    nutrition: nutritionForDocument(document),
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function hourKey(document: MealLogDoc): string {
  return `${timeInChile(document.consumedAt).slice(0, 2)}:00`;
}
