/* Utilidades de fecha deterministas y seguras frente a zonas horarias.
   Centralizan el cálculo de ventanas de días y semanas para PagerView.

   Dos caminos distintos, y la diferencia importa para el rendimiento:

   - Pasar de un instante real a día calendario chileno necesita la zona
     horaria, o sea `Intl`. Ese formateador se construye una sola vez y se
     reutiliza: crearlo en cada llamada costaba unas treinta veces más y se
     hacía decenas de veces por render.
   - Mover, alinear o enumerar dateIds no necesita zona horaria. Se hace con
     aritmética sobre mediodía UTC, sin tocar `Intl`. Chile va de UTC-4 a
     UTC-3, así que el mediodía UTC cae entre las 08:00 y las 09:00 del mismo
     día calendario, siempre. */

const CHILE_TIME_ZONE = 'America/Santiago';

/** Único formateador del módulo. Perezoso, para no pagarlo al importar. */
let chileFormatter: Intl.DateTimeFormat | null = null;

function getChileFormatter(): Intl.DateTimeFormat {
  chileFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return chileFormatter;
}

export function chileDateParts(epochMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = getChileFormatter().formatToParts(new Date(epochMs));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

/** Formatea un año/mes/día ya resuelto como dateId. */
function formatDateId(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** All user-facing day boundaries use Chile, independent of device timezone. */
export function toDateId(date: Date): string {
  const p = chileDateParts(date.getTime());
  return formatDateId(p.year, p.month, p.day);
}

/**
 * dateId de una fecha construida a mediodía UTC. Aritmética pura: el día
 * calendario chileno del mediodía UTC es el mismo día UTC.
 */
function utcNoonDateId(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return formatDateId(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/* `todayId()` se consulta en listas y en cada render. La respuesta solo puede
   cambiar al cruzar la medianoche, así que se memoiza por minuto. */
let todayCache: { minute: number; dateId: string } | null = null;

export function todayId(): string {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  if (todayCache?.minute !== minute) {
    todayCache = { minute, dateId: toDateId(new Date(now)) };
  }
  return todayCache.dateId;
}

export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export function displayDateFor(dateId: string): string {
  const [year, month, day] = dateId.split('-').map(Number);
  if (!year || !month || !day) return dateId;
  // Mediodía UTC: mismo día calendario en Chile, sin pasar por Intl.
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return `${dateId === todayId() ? 'Hoy, ' : ''}${DAY_NAMES[weekday]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

/** Convierte "YYYY-MM-DD" a Date en hora UTC Noon (evita bordes DST). */
export function parseDateId(dateId: string): Date {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) {
    // Respaldo con la misma convención que el camino normal: mediodía UTC.
    const p = chileDateParts(Date.now());
    return new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  }
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Desplaza un dateId N días de forma determinista y segura frente a husos horarios. */
export function shiftDateId(dateId: string, days: number): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  return utcNoonDateId(y, m, d + days);
}

/** Obtiene el dateId del lunes de la semana que contiene `dateId`. */
export function getMondayDateId(dateId: string): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0 = Domingo
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return utcNoonDateId(y, m, d + offsetToMonday);
}

const DAYS_PER_WEEK = 7;

/**
 * Ventana de dias centrada en la semana de `dateId`, alineada a lunes.
 * Alimenta el PagerView: `weeksBefore` semanas antes y `weeksAfter`
 * despues, para poder deslizar sin regenerar.
 */
export function buildDateWindow(dateId: string, weeksBefore = 3, weeksAfter = 3): string[] {
  const mondayId = getMondayDateId(dateId);
  const [y, m, d] = mondayId.split('-').map(Number);
  if (!y || !m || !d) return [];
  const firstDay = d - weeksBefore * DAYS_PER_WEEK;
  const total = (weeksBefore + 1 + weeksAfter) * DAYS_PER_WEEK;

  return Array.from({ length: total }, (_, i) => utcNoonDateId(y, m, firstDay + i));
}

export interface DateItem {
  dateId: string;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
}

export interface WeekGroup {
  weekIndex: number;
  startDateId: string;
  days: DateItem[];
}

const LABELS_MON = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function buildWeekGroup(mondayDateId: string, weekIndex: number, todayIdStr = todayId()): WeekGroup {
  const [y, m, d] = mondayDateId.split('-').map(Number);

  const days: DateItem[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i, 12, 0, 0));
    const dayNum = day.getUTCDate();
    const dId = utcNoonDateId(day.getUTCFullYear(), day.getUTCMonth() + 1, dayNum);
    days.push({
      dateId: dId,
      dayName: LABELS_MON[i] ?? '',
      dayNumber: dayNum,
      isToday: dId === todayIdStr,
    });
  }
  return {
    weekIndex,
    startDateId: days[0]?.dateId ?? mondayDateId,
    days,
  };
}

export function generateWeeksWindow(
  anchorDateId: string,
  weeksBefore = 2,
  weeksAfter = 2,
  todayIdStr = todayId()
): WeekGroup[] {
  const anchorMonday = getMondayDateId(anchorDateId);
  const [y, m, d] = anchorMonday.split('-').map(Number);
  const total = weeksBefore + 1 + weeksAfter;
  const weeks: WeekGroup[] = [];

  for (let i = 0; i < total; i++) {
    const offset = i - weeksBefore;
    const weekMonday = utcNoonDateId(y, m, d + offset * DAYS_PER_WEEK);
    weeks.push(buildWeekGroup(weekMonday, i, todayIdStr));
  }
  return weeks;
}

/** "HH:MM" de ahora. Se repetia en tres pantallas. */
export function currentTimeString(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
