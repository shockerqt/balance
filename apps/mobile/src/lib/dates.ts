import { toDateId } from '@/hooks/use-meal-store';

/* Utilidades de fecha. Vivian dentro de la pantalla de registros, que
   no tiene por que saber como se construye una ventana de semanas. */

/** Convierte "YYYY-MM-DD" a Date en hora local. */
export function parseDateId(dateId: string): Date {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

const DAYS_PER_WEEK = 7;

/**
 * Ventana de dias centrada en la semana de `dateId`, alineada a lunes.
 * Alimenta el PagerView: `weeksBefore` semanas antes y `weeksAfter`
 * despues, para poder deslizar sin regenerar.
 */
export function buildDateWindow(dateId: string, weeksBefore = 2, weeksAfter = 2): string[] {
  const base = parseDateId(dateId);

  // getDay(): 0 = domingo. Retrocedemos al lunes de esa semana.
  const offsetToMonday = base.getDay() === 0 ? -6 : 1 - base.getDay();

  const start = new Date(base);
  start.setDate(base.getDate() + offsetToMonday - weeksBefore * DAYS_PER_WEEK);

  const total = (weeksBefore + 1 + weeksAfter) * DAYS_PER_WEEK;

  return Array.from({ length: total }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return toDateId(day);
  });
}

/** "HH:MM" de ahora. Se repetia en tres pantallas. */
export function currentTimeString(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
