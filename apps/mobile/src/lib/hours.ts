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

export interface HourRange {
  /** Hora de inicio, 0–23 */
  from: number;
  /** Hora de fin, inclusive, 0–23 */
  to: number;
}

/**
 * Tramo que se muestra por defecto. Cubre un dia normal de comidas
 * sin llenar la pantalla con la madrugada.
 */
export const DEFAULT_HOUR_RANGE: HourRange = { from: 5, to: 22 };

export interface HourSlot {
  /** "HH:00" */
  hour: string;
  foods: LoggedFoodItem[];
}

/**
 * Riel continuo de horas. Siempre cubre el rango configurado, tenga o
 * no registros: un dia vacio muestra el riel completo, que es la forma
 * de anotar la primera comida sin buscar un boton.
 *
 * Si hay comida fuera del rango —una colacion a las 02:00— el tramo se
 * estira para incluirla en vez de esconderla.
 */
export function buildHourRail(
  foods: LoggedFoodItem[],
  range: HourRange = DEFAULT_HOUR_RANGE
): HourSlot[] {
  const byHour = new Map<string, LoggedFoodItem[]>();
  for (const food of foods) {
    const key = snapToHour(food.time || '12:00');
    byHour.set(key, [...(byHour.get(key) ?? []), food]);
  }

  const logged = [...byHour.keys()].map((h) => Number(h.slice(0, 2)));
  const first = Math.min(range.from, ...logged);
  const last = Math.max(range.to, ...logged);

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
