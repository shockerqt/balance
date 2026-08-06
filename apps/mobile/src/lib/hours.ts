import { LoggedFoodItem } from '@/hooks/use-meal-store';

/* ============================================================
   Agrupado por hora.

   La hora exacta se conserva en el registro, pero para agrupar se
   cuadra a la hora mas cercana. Registrar el pan a las 08:05 y el
   cafe a las 08:20 era un desayuno, no dos momentos distintos.
   ============================================================ */

/** Cuadra "HH:MM" a la hora mas cercana, con el empate hacia abajo. */
export function snapToHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h)) return '00:00';
  const hour = ((m ?? 0) > 30 ? h + 1 : h) % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

export interface HourSlot {
  /** "HH:00" */
  hour: string;
  foods: LoggedFoodItem[];
}

/**
 * Devuelve un tramo continuo de horas entre el primer y el ultimo
 * registro. Las horas sin comida vienen con la lista vacia: se
 * muestran apagadas y son el punto para registrar ahi.
 */
export function buildHourRail(foods: LoggedFoodItem[]): HourSlot[] {
  if (!foods.length) return [];

  const byHour = new Map<string, LoggedFoodItem[]>();
  for (const food of foods) {
    const key = snapToHour(food.time || '12:00');
    byHour.set(key, [...(byHour.get(key) ?? []), food]);
  }

  const hours = [...byHour.keys()].sort();
  const first = Number(hours[0].slice(0, 2));
  const last = Number(hours[hours.length - 1].slice(0, 2));

  return Array.from({ length: last - first + 1 }, (_, i) => {
    const hour = `${String(first + i).padStart(2, '0')}:00`;
    return { hour, foods: byHour.get(hour) ?? [] };
  });
}

export function sumFoods(foods: LoggedFoodItem[]) {
  return foods.reduce(
    (acc, f) => ({
      calories: acc.calories + (f.calories || 0),
      protein: acc.protein + (f.protein || 0),
      carbs: acc.carbs + (f.carbs || 0),
      fat: acc.fat + (f.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
