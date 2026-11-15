/* Utilidades de fecha deterministas y seguras frente a zonas horarias.
   Centralizan el cálculo de días y semanas del calendario.

   Dos caminos distintos, y la diferencia importa para el rendimiento:

   - Pasar de un instante real a día calendario chileno usa un desfase por
     hora UTC, compartido por fecha y hora. Intl resuelve cada hora nueva;
     las conversiones repetidas son aritméticas y la caché está acotada.
   - Mover, alinear o enumerar dateIds no necesita zona horaria. Se hace con
     aritmética sobre mediodía UTC, sin tocar `Intl`. Chile va de UTC-4 a
     UTC-3, así que el mediodía UTC cae entre las 08:00 y las 09:00 del mismo
     día calendario, siempre. */

const CHILE_TIME_ZONE = 'America/Santiago';

/** Formateadores perezosos; el de hora solo conserva el camino histórico. */
let chileFormatter: Intl.DateTimeFormat | null = null;
let historicalTimeFormatter: Intl.DateTimeFormat | null = null;
const MS_PER_HOUR = 3_600_000;
const OFFSET_CACHE_END = Date.UTC(2100, 0, 1);
const OFFSET_CACHE_LIMIT = 16_384;
// Santiago's transitions from 1970 through 2099 fall on UTC-hour boundaries.
// Intl's runtime timezone data remains authoritative; no DST dates/offsets are
// hardcoded. Earlier offsets can contain seconds, so retain direct Intl there.
// FIFO bounds runtime memory; an evicted hour may need another Intl conversion.
const chileOffsets = new Map<number, number>();

type ChileDateParts = { year: number; month: number; day: number; hour: number; minute: number };

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

function directChileDateParts(date: Date): ChileDateParts {
  const parts = getChileFormatter().formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) if (part.type !== 'literal') values[part.type] = Number(part.value);
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

function cacheableChileInstant(epochMs: number): boolean {
  return epochMs >= 0 && epochMs < OFFSET_CACHE_END;
}

function cachedChileOffset(timestamp: number): number {
  const hour = Math.floor(timestamp / MS_PER_HOUR);
  let offset = chileOffsets.get(hour);
  if (offset === undefined) {
    const hourStart = hour * MS_PER_HOUR;
    const p = directChileDateParts(new Date(hourStart));
    offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - hourStart;
    if (chileOffsets.size === OFFSET_CACHE_LIMIT) chileOffsets.delete(chileOffsets.keys().next().value!);
    chileOffsets.set(hour, offset);
  }
  return offset;
}

export function chileDateParts(epochMs: number): ChileDateParts {
  // Date applies TimeClip before the offset is added. In particular, fractional
  // milliseconds near epoch zero must not round a shifted negative timestamp
  // into the following minute.
  const instant = new Date(epochMs);
  const timestamp = instant.getTime();
  if (!cacheableChileInstant(timestamp)) return directChileDateParts(instant);
  const local = new Date(timestamp + cachedChileOffset(timestamp));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** Shared displayed time; out-of-range instants retain the adapter's locale. */
export function chileTimeString(epochMs: number): string {
  const timestamp = Math.trunc(epochMs);
  if (cacheableChileInstant(timestamp)) {
    const localMinute = Math.floor((timestamp + cachedChileOffset(timestamp)) / 60_000);
    const minuteOfDay = ((localMinute % 1440) + 1440) % 1440;
    return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  }
  historicalTimeFormatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: CHILE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return historicalTimeFormatter.format(new Date(epochMs));
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

const MS_PER_DAY = 86_400_000;
/* Mediodia UTC dentro del dia, en milisegundos. Es el mismo ancla que usa el
   resto del modulo para no pisar los bordes de horario de verano. */
const UTC_NOON_MS = MS_PER_DAY / 2;

/**
 * Dia absoluto de un dateId: un entero contable en el que sumar uno es sumar un
 * dia. Es la unidad que compartimos con el hilo de UI, porque un worklet no
 * puede partir cadenas ni construir `Date`s: interpolar entre dos enteros si.
 */
export function dateIdToEpochDay(dateId: string): number {
  const [y, m, d] = dateId.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / MS_PER_DAY);
}

/** Inversa exacta de `dateIdToEpochDay`. */
export function epochDayToDateId(epochDay: number): string {
  const date = new Date(epochDay * MS_PER_DAY + UTC_NOON_MS);
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
 * Incluye `weeksBefore` semanas antes y `weeksAfter` después.
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
  /* Dia absoluto. Lo precalcula la ventana para que la animacion de la banda
     no tenga que derivarlo por pildora en cada frame. */
  epochDay: number;
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
      epochDay: Math.floor(day.getTime() / MS_PER_DAY),
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

/** Converts a "YYYY-MM-DD" string to a device-local Date (noon to avoid DST midnight edge cases). */
export function dateIdToLocalDate(dateId: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    const [year, month, day] = dateId.split('-').map(Number);
    const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      return candidate;
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

/** Formats a device-local Date as "YYYY-MM-DD". */
export function localDateToDateId(date: Date): string {
  return formatDateId(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Converts an "HH:mm" string to a device-local Date on today's calendar day. */
export function timeStringToLocalDate(timeStr: string, fallbackTime = '08:30'): Date {
  const parse = (value: string): [number, number] | null => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
  };
  const [hour, minute] = parse(timeStr) ?? parse(fallbackTime) ?? [8, 30];
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Formats a device-local Date as "HH:mm". */
export function localDateToTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function chileOffsetAt(epochMs: number): number {
  const p = chileDateParts(epochMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epochMs;
}

export function epochForChileDateTime(dateId: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = dateId.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  if (dateOnly.getUTCFullYear() !== year || dateOnly.getUTCMonth() !== month - 1 || dateOnly.getUTCDate() !== day) return null;
  const desired = Date.UTC(year, month - 1, day, Number.isFinite(hour) ? hour : 12, Number.isFinite(minute) ? minute : 0);
  let epoch = desired - chileOffsetAt(desired);
  epoch = desired - chileOffsetAt(epoch);
  const resolved = chileDateParts(epoch);
  if (resolved.year !== year || resolved.month !== month || resolved.day !== day || resolved.hour !== hour || resolved.minute !== minute) return null;
  return epoch;
}
