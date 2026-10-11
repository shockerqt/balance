import type { DayLog } from '@/hooks/use-meal-store';
import { DEFAULT_TARGETS } from '@/lib/day-targets';
import type { WeightLogDoc } from '@/services/sync/types';
import { isDateId } from '@/services/sync/types';
import { formatCalories, formatMacroGrams, sumNutrition } from '@/lib/nutrition';
import type { DailyLogEvent } from '../../../../modules/balance-daily-log';

export function projectDays(logs: Record<string, DayLog>, weights: Record<string, WeightLogDoc>) {
  return Object.fromEntries([...new Set([...Object.keys(logs), ...Object.keys(weights)])].filter(isDateId).map(date => {
    const log = logs[date];
    const foods = log?.foods ?? [];
    const totals = sumNutrition(foods);
    return [date, {
      calories: formatCalories(totals.calories),
      target: formatCalories(log?.targetCalories ?? DEFAULT_TARGETS.targetCalories),
      progress: totals.calories / Math.max(1, log?.targetCalories ?? DEFAULT_TARGETS.targetCalories),
      macros: [
        ['Proteína', totals.protein, log?.targetProtein ?? DEFAULT_TARGETS.targetProtein, 'macroProtein'],
        ['Carbos', totals.carbs, log?.targetCarbs ?? DEFAULT_TARGETS.targetCarbs, 'macroCarbs'],
        ['Grasas', totals.fat, log?.targetFat ?? DEFAULT_TARGETS.targetFat, 'macroFat'],
        ['Fibra', totals.fiber, log?.targetFiber ?? DEFAULT_TARGETS.targetFiber, 'macroFiber'],
      ].map(([name, value, target, color]) => ({ name, value: formatMacroGrams(value as number), target: formatMacroGrams(target as number), color })),
      weight: weights[date] ? `${formatMacroGrams(weights[date].weightGrams / 1000)} kg` : null,
      foods: [...foods].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)).map(food => ({
        id: food.id, name: food.name, portion: food.portion, time: food.time,
        calories: formatCalories(food.calories),
        macros: `P ${formatMacroGrams(food.protein)} · C ${formatMacroGrams(food.carbs)} · G ${formatMacroGrams(food.fat)}`,
      })),
    }];
  }));
}

// The bridge is an input boundary: never trust queued native callbacks after
// navigation, unmount, account replacement or removal of their target records.
export function acceptDailyEvent(value: unknown, session: string, lastSequence: number, selected: string, logs: Record<string, DayLog>): value is DailyLogEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as DailyLogEvent;
  if (e.session !== session || !Number.isSafeInteger(e.sequence) || e.sequence <= lastSequence || !isDateId(e.date)) return false;
  if (e.action === 'date') return true;
  if (!['add', 'edit', 'weight', 'delete', 'move'].includes(e.action) || e.date !== selected) return false;
  if (e.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) return false;
  if (['edit', 'delete', 'move'].includes(e.action)) {
    if (!Array.isArray(e.ids) || !e.ids.length || new Set(e.ids).size !== e.ids.length) return false;
    if (!e.ids.every(id => typeof id === 'string' && logs[e.date]?.foods.some(f => f.id === id))) return false;
    if (e.action === 'edit' && e.ids.length !== 1) return false;
    if (e.action === 'move' && !e.time) return false;
  }
  return true;
}
