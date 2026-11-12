import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { sumNutrition } from '@/lib/nutrition';
import { snapToHour } from '@/lib/hours';

/* ============================================================
   Diario agrupado por hora.

   Solo aparecen las horas con registros, como en el rediseño: cada
   hora es una cabecera (hora, total, +) y una tarjeta de lista. La
   tarjeta se dibuja fila por fila para que la lista siga reciclando
   celdas: cada fila sabe si abre o cierra su tarjeta.
   ============================================================ */

export type MealGroupRow =
  | { kind: 'header'; key: string; hour: string; ids: string[]; calories: number }
  | { kind: 'food'; key: string; hour: string; food: LoggedFoodItem; first: boolean; last: boolean };

export function buildMealGroupRows(foods: LoggedFoodItem[]): MealGroupRow[] {
  const byHour = new Map<string, LoggedFoodItem[]>();
  for (const food of foods) {
    const hour = snapToHour(food.time || '12:00');
    const group = byHour.get(hour);
    if (group) group.push(food);
    else byHour.set(hour, [food]);
  }
  const rows: MealGroupRow[] = [];
  for (const hour of [...byHour.keys()].sort()) {
    const group = [...byHour.get(hour)!].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
    rows.push({ kind: 'header', key: `h:${hour}`, hour, ids: group.map(food => food.id), calories: sumNutrition(group).calories });
    group.forEach((food, index) => rows.push({ kind: 'food', key: `f:${food.id}`, hour, food, first: index === 0, last: index === group.length - 1 }));
  }
  return rows;
}
