/* Utilidades de fecha deterministas y seguras frente a zonas horarias.
   Centralizan el cálculo de ventanas de días y semanas para PagerView. */

const CHILE_TIME_ZONE = 'America/Santiago';

export function chileDateParts(epochMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
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

/** All user-facing day boundaries use Chile, independent of device timezone. */
export function toDateId(date: Date): string {
  const p = chileDateParts(date.getTime());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayId(): string {
  return toDateId(new Date());
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
  // Noon UTC avoids the Chile midnight transition for display-only dates.
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const chile = chileDateParts(date.getTime());
  const weekday = new Date(Date.UTC(chile.year, chile.month - 1, chile.day, 12)).getUTCDay();
  return `${dateId === todayId() ? 'Hoy, ' : ''}${DAY_NAMES[weekday]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

/** Convierte "YYYY-MM-DD" a Date en hora UTC Noon (evita bordes DST). */
export function parseDateId(dateId: string): Date {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Desplaza un dateId N días de forma determinista y segura frente a husos horarios. */
export function shiftDateId(dateId: string, days: number): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return toDateId(date);
}

/** Obtiene el dateId del lunes de la semana que contiene `dateId`. */
export function getMondayDateId(dateId: string): string {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return dateId;
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = base.getUTCDay(); // 0 = Domingo, 1 = Lunes, ...
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(Date.UTC(y, m - 1, d + offsetToMonday, 12, 0, 0));
  return toDateId(monday);
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
  const startMonday = new Date(Date.UTC(y, m - 1, d - weeksBefore * DAYS_PER_WEEK, 12, 0, 0));
  const total = (weeksBefore + 1 + weeksAfter) * DAYS_PER_WEEK;

  return Array.from({ length: total }, (_, i) => {
    const day = new Date(
      Date.UTC(startMonday.getUTCFullYear(), startMonday.getUTCMonth(), startMonday.getUTCDate() + i, 12, 0, 0)
    );
    return toDateId(day);
  });
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
    const dId = toDateId(day);
    const [, , dayNum] = dId.split('-').map(Number);
    days.push({
      dateId: dId,
      dayName: LABELS_MON[i] ?? '',
      dayNumber: dayNum ?? day.getUTCDate(),
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
    const weekMonday = new Date(Date.UTC(y, m - 1, d + offset * DAYS_PER_WEEK, 12, 0, 0));
    weeks.push(buildWeekGroup(toDateId(weekMonday), i, todayIdStr));
  }
  return weeks;
}

/** "HH:MM" de ahora. Se repetia en tres pantallas. */
export function currentTimeString(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
