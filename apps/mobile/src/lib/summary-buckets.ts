import { dateIdToEpochDay, epochDayToDateId } from '@/lib/dates';

/* ============================================================
   Agregados del Resumen.

   7 dias: una barra por dia. 30 dias: 10 barras de 3 dias. 90 dias:
   12 barras de 7–8 dias. Cada barra promedia solo los dias con
   registros; un dia sin alimentos no cuenta como cero.
   ============================================================ */

export type SummaryDay = { recorded: boolean; calories: number; protein: number; carbs: number; fat: number; weightKg: number | null };
export type Bucket = { start: string; end: string; average: number | null; latestRecorded: string | null; recordedDays: number };

const BUCKETS: Record<number, number> = { 7: 7, 30: 10, 90: 12 };

export function summaryBuckets(days: Record<string, SummaryDay | undefined>, end: string, period: number): Bucket[] {
  const count = BUCKETS[period] ?? period;
  const first = dateIdToEpochDay(end) - (period - 1);
  return Array.from({ length: count }, (_, i) => {
    const from = first + Math.floor(i * period / count);
    const to = first + Math.floor((i + 1) * period / count) - 1;
    let total = 0, recordedDays = 0, latestRecorded: string | null = null;
    for (let day = from; day <= to; day++) {
      const date = epochDayToDateId(day);
      const value = days[date];
      if (!value?.recorded) continue;
      total += value.calories; recordedDays++; latestRecorded = date;
    }
    return { start: epochDayToDateId(from), end: epochDayToDateId(to), average: recordedDays ? total / recordedDays : null, latestRecorded, recordedDays };
  });
}

export type RangeSummary = {
  recordedDays: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  weights: { date: string; kg: number }[];
};

/** Promedios por dia registrado y pesos del rango, en orden. */
export function rangeSummary(days: Record<string, SummaryDay | undefined>, end: string, period: number): RangeSummary {
  const first = dateIdToEpochDay(end) - (period - 1);
  let n = 0, calories = 0, protein = 0, carbs = 0, fat = 0;
  const weights: { date: string; kg: number }[] = [];
  for (let day = first; day <= first + period - 1; day++) {
    const date = epochDayToDateId(day);
    const value = days[date];
    if (!value) continue;
    if (value.recorded) { n++; calories += value.calories; protein += value.protein; carbs += value.carbs; fat += value.fat; }
    if (value.weightKg !== null && Number.isFinite(value.weightKg)) weights.push({ date, kg: value.weightKg });
  }
  return { recordedDays: n, calories: n ? calories / n : null, protein: n ? protein / n : null, carbs: n ? carbs / n : null, fat: n ? fat / n : null, weights };
}
