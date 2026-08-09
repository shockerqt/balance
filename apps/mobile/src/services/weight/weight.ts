import type { WeightLogDoc } from '@/services/sync/types';

export const MIN_WEIGHT_GRAMS = 1_000;
export const MAX_WEIGHT_GRAMS = 500_000;

export function parseWeightInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,3}(?:\.\d)?$/.test(normalized)) return null;
  const grams = Math.round(Number(normalized) * 1000);
  if (grams < MIN_WEIGHT_GRAMS || grams > MAX_WEIGHT_GRAMS || grams % 100 !== 0) return null;
  return grams;
}

export function formatWeight(weightGrams: number): string {
  return (weightGrams / 1000).toLocaleString('es-CL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function mergeWeightLogs(previous: WeightLogDoc[], incoming: unknown[]): WeightLogDoc[] {
  const byId = new Map(previous.map((doc) => [doc.id, doc]));
  for (const value of incoming) {
    if (!isWeightLog(value)) continue;
    const current = byId.get(value.id);
    if (!current || value.updatedAt > current.updatedAt) byId.set(value.id, value);
  }
  return Array.from(byId.values());
}

function isWeightLog(value: unknown): value is WeightLogDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.id === 'string' &&
    typeof doc.weightGrams === 'number' &&
    Number.isInteger(doc.weightGrams) &&
    doc.weightGrams >= MIN_WEIGHT_GRAMS &&
    doc.weightGrams <= MAX_WEIGHT_GRAMS &&
    doc.weightGrams % 100 === 0 &&
    typeof doc.updatedAt === 'number' &&
    Number.isFinite(doc.updatedAt) &&
    typeof doc._deleted === 'boolean'
  );
}

export function previousWeight(
  logs: Record<string, WeightLogDoc>,
  dateId: string
): WeightLogDoc | null {
  const dates = Object.keys(logs)
    .filter((date) => date < dateId)
    .sort();
  return dates.length ? logs[dates[dates.length - 1]] : null;
}

const DAY_INITIALS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export function weightTrendDates(dateId: string): { id: string; initial: string }[] {
  const [year, month, day] = dateId.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day, 12));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const id = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return { id, initial: DAY_INITIALS[date.getUTCDay()] ?? '' };
  });
}
