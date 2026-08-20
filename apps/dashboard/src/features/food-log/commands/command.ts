import type { MealTemplateDoc, MealUnit } from '../../../types/meal-log.ts';
import type { FoodLogMode } from '../domain/food-log-state.ts';

export type Operator = 'delete' | 'yank' | 'normalize';

export type Motion =
  | { type: 'item'; direction: -1 | 1; count: number }
  | { type: 'block'; direction: -1 | 1; count: number }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'index'; index: number };

export type Target =
  | { type: 'current'; count: number }
  | { type: 'selection' }
  | { type: 'motion'; motion: Motion }
  | { type: 'hour-block'; count: number }
  | { type: 'block-tail' };

export type FoodLogCommand =
  | { type: 'move-cursor'; motion: Motion }
  | { type: 'change-day'; delta: number }
  | { type: 'go-today' }
  | { type: 'toggle-visual' }
  | { type: 'select-hour-block' }
  | { type: 'cancel-mode' }
  | { type: 'operate'; operator: Operator; target: Target }
  | { type: 'paste'; side: 'before' | 'after'; count: number }
  | { type: 'move-rows'; direction: -1 | 1; count: number }
  | { type: 'undo'; count: number }
  | { type: 'redo'; count: number }
  | { type: 'repeat' }
  | { type: 'open-add'; side: 'before' | 'after' | 'now' | 'explicit'; timeLiteral?: string }
  | { type: 'open-replace' }
  | { type: 'open-quantity-editor' }
  | { type: 'open-time-editor' }
  | { type: 'open-search' }
  | { type: 'open-help' }
  | { type: 'next-search'; direction: -1 | 1 }
  | { type: 'add-food'; template: MealTemplateDoc; side: 'before' | 'after' | 'now' | 'explicit'; time?: string }
  | { type: 'replace-food'; template: MealTemplateDoc }
  | { type: 'set-quantity'; quantity: number; unit: MealUnit }
  | { type: 'set-time'; target: Target; time: string }
  | { type: 'shift-time'; target: Target; minutes: number }
  | { type: 'search'; query: string; direction: -1 | 1; includeCurrent?: boolean };

export interface PendingOperator {
  operator: Operator;
  operatorCount: number;
  motionCount: string;
  objectPrefix: 'inner' | 'around' | null;
  awaitingG: boolean;
}

export interface ParserState {
  count: string;
  pendingOperator: PendingOperator | null;
  pendingG: boolean;
}

export interface ParserOutput {
  state: ParserState;
  command: FoodLogCommand | null;
  consumed: boolean;
}

export function emptyParserState(): ParserState {
  return { count: '', pendingOperator: null, pendingG: false };
}

export function pendingKeys(state: ParserState): string {
  if (state.pendingOperator) {
    const operator = state.pendingOperator.operator === 'delete'
      ? 'd'
      : state.pendingOperator.operator === 'yank'
        ? 'y'
        : '=';
    const prefix = state.pendingOperator.objectPrefix === 'inner'
      ? 'i'
      : state.pendingOperator.objectPrefix === 'around'
        ? 'a'
        : '';
    return `${operator}${state.pendingOperator.motionCount}${prefix}${state.pendingOperator.awaitingG ? 'g' : ''}_`;
  }
  if (state.pendingG) return 'g_';
  return state.count ? `${state.count}_` : '';
}
