import type { LoggedFoodItem } from '@/hooks/use-meal-store';
import { sumNutrition } from '@/lib/nutrition';
import { snapToHour } from '@/lib/hours';

/* ============================================================
   Diario agrupado por hora.

   Solo aparecen las horas con registros, como en el rediseño: cada
   hora es una cabecera (hora, total, +) y una tarjeta de lista. Cada
   grupo es una celda de la lista: la tarjeta es una sola vista con un
   borde uniforme, sin costuras entre filas en Android.
   ============================================================ */

export type MealGroup = { key: string; hour: string; ids: string[]; calories: number; foods: LoggedFoodItem[] };

const timeOf = (food: LoggedFoodItem) => food.time || '12:00';

export function buildMealGroups(foods: LoggedFoodItem[]): MealGroup[] {
  const byHour = new Map<string, LoggedFoodItem[]>();
  for (const food of foods) {
    const hour = snapToHour(timeOf(food));
    const group = byHour.get(hour);
    if (group) group.push(food);
    else byHour.set(hour, [food]);
  }
  return [...byHour.keys()].sort().map(hour => {
    const group = [...byHour.get(hour)!].sort((a, b) => timeOf(a).localeCompare(timeOf(b)) || a.id.localeCompare(b.id));
    return { key: `h:${hour}`, hour, ids: group.map(food => food.id), calories: sumNutrition(group).calories, foods: group };
  });
}
