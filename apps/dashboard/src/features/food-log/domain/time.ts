export const CHILE_TIME_ZONE = 'America/Santiago';
const DAY_MS = 86_400_000;

interface ChileDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function chileDateParts(epochMs: number): ChileDateParts {
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
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

export function toDateId(value: Date | number): string {
  const epochMs = value instanceof Date ? value.getTime() : value;
  const parts = chileDateParts(epochMs);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function todayId(): string {
  return toDateId(Date.now());
}

function parseDateId(dateId: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return null;
  const [year, month, day] = dateId.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function chileOffsetAt(epochMs: number): number {
  const parts = chileDateParts(epochMs);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - epochMs;
}

export function epochForChileDateTime(dateId: string, time: string): number | null {
  const date = parseDateId(dateId);
  if (!date || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;

  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let epoch = desired - chileOffsetAt(desired);
  epoch = desired - chileOffsetAt(epoch);

  const resolved = chileDateParts(epoch);
  if (
    resolved.year !== date.year ||
    resolved.month !== date.month ||
    resolved.day !== date.day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    return null;
  }

  return epoch;
}

export function timeInChile(epochMs: number): string {
  const parts = chileDateParts(epochMs);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function addDays(dateId: string, delta: number): string {
  const parsed = parseDateId(dateId);
  if (!parsed) return dateId;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + delta, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function dateDeltaFromToday(dateId: string): number {
  const current = parseDateId(todayId());
  const target = parseDateId(dateId);
  if (!current || !target) return 0;
  const currentMs = Date.UTC(current.year, current.month - 1, current.day);
  const targetMs = Date.UTC(target.year, target.month - 1, target.day);
  return Math.round((targetMs - currentMs) / DAY_MS);
}

export function relationForDate(dateId: string): string {
  const delta = dateDeltaFromToday(dateId);
  if (delta === 0) return 'today';
  if (delta === -1) return 'yesterday';
  if (delta === 1) return 'tomorrow';
  return delta < 0 ? `${Math.abs(delta)} days ago` : `in ${delta} days`;
}

export function labelForDate(dateId: string): string {
  const parsed = parseDateId(dateId);
  if (!parsed) return dateId;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12))
    .toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', timeZone: 'UTC' })
    .toUpperCase();
}

export function monthLabelForDate(dateId: string): string {
  const parsed = parseDateId(dateId);
  if (!parsed) return '';
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12))
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

export interface MonthGridCell {
  dateId: string;
  outside: boolean;
}

export function monthGrid(dateId: string): MonthGridCell[] {
  const parsed = parseDateId(dateId);
  if (!parsed) return [];
  const first = new Date(Date.UTC(parsed.year, parsed.month - 1, 1, 12));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      dateId: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
      outside: date.getUTCMonth() !== parsed.month - 1,
    };
  });
}

export function parseCompactTime(raw: string): string | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  let hour: number;
  let minute: number;
  if (raw.length <= 2) {
    hour = Number(raw);
    minute = 0;
  } else {
    hour = Number(raw.slice(0, -2));
    minute = Number(raw.slice(-2));
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export type TimeExpression =
  | { kind: 'absolute'; time: string }
  | { kind: 'relative'; minutes: number };

export function parseTimeExpression(raw: string): TimeExpression | null {
  const value = raw.trim().toLowerCase();
  const absolute = parseCompactTime(value);
  if (absolute) return { kind: 'absolute', time: absolute };
  const relative = value.match(/^([+-])(\d+)(h)?$/);
  if (!relative) return null;
  const magnitude = Number(relative[2]) * (relative[3] ? 60 : 1);
  return {
    kind: 'relative',
    minutes: relative[1] === '-' ? -magnitude : magnitude,
  };
}

export function shiftEpochMinutes(epochMs: number, minutes: number): number {
  return epochMs + minutes * 60_000;
}
