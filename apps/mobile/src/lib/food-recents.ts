import type { MealLogDoc, MealTemplateDoc } from '@/services/sync/types';
import { chileDateParts } from './dates';

/* ============================================================
   Recientes y frecuentes para agregar alimentos.

   Salen del historial de registros que apuntan a un alimento de la
   biblioteca (templateId). Recientes: ultimo uso en los ultimos 30
   dias, del mas nuevo al mas viejo. Frecuentes: cantidad de usos en
   los ultimos 90 dias; empata por el uso mas nuevo.
   ============================================================ */

const DAY = 24 * 60 * 60 * 1000;

type Usage = { count: number; latest: number };

function usage(logs: readonly MealLogDoc[], since: number): Map<string, Usage> {
  const byTemplate = new Map<string, Usage>();
  for (const log of logs) {
    if (log._deleted || !log.templateId || log.consumedAt < since) continue;
    const current = byTemplate.get(log.templateId);
    if (current) { current.count++; current.latest = Math.max(current.latest, log.consumedAt); }
    else byTemplate.set(log.templateId, { count: 1, latest: log.consumedAt });
  }
  return byTemplate;
}

function live(templates: readonly MealTemplateDoc[]) {
  return new Map(templates.filter(t => !t._deleted).map(t => [t.id, t]));
}

export function recentTemplates(logs: readonly MealLogDoc[], templates: readonly MealTemplateDoc[], now: number, days = 30): MealTemplateDoc[] {
  const byId = live(templates);
  return [...usage(logs, now - days * DAY)].filter(([id]) => byId.has(id))
    .sort(([a, x], [b, y]) => y.latest - x.latest || a.localeCompare(b)).map(([id]) => byId.get(id)!);
}

export function frequentTemplates(logs: readonly MealLogDoc[], templates: readonly MealTemplateDoc[], now: number, days = 90): MealTemplateDoc[] {
  const byId = live(templates);
  return [...usage(logs, now - days * DAY)].filter(([id]) => byId.has(id))
    .sort(([a, x], [b, y]) => y.count - x.count || y.latest - x.latest || a.localeCompare(b)).map(([id]) => byId.get(id)!);
}

/** Alimentos propios, por nombre. */
export function personalTemplates(templates: readonly MealTemplateDoc[]): MealTemplateDoc[] {
  return templates.filter(t => !t._deleted && !t.isOfficial).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Busca en toda la biblioteca, sin distinguir mayusculas ni tildes. */
export function searchTemplates(templates: readonly MealTemplateDoc[], query: string, limit = 50): MealTemplateDoc[] {
  const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
  const text = fold(query.trim());
  const live = templates.filter(t => !t._deleted);
  if (!text) return live.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, limit);
  const rank = (t: MealTemplateDoc) => {
    const name = fold(t.name);
    if (name.startsWith(text)) return 0;
    if (name.includes(text)) return 1;
    return 2;
  };
  return live
    .filter(t => fold(t.name).includes(text) || fold(t.details.brand ?? '').includes(text))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit);
}

/* ============================================================
   Sugeridos por hora del registro.

   Sigue la lectura de `suggestion-system-spec.md`: cada registro suma
   0.98^dias (dias calendario de Chile hasta `now`) a su casilla
   (alimento, hora de Chile), equivalente a la recurrencia
   Score = Score * 0.98^dt + 1 evaluada en `now`. Cada casilla pesa segun
   su distancia circular a la hora pedida: 0h -> 1, 1h -> 0.5, 2h -> 0.2,
   mas lejos -> 0 (23:00 y 00:00 estan a una hora).

   Diferencias con la spec: se calcula en el dispositivo desde los
   registros (sin tabla persistida), la ventana de `days` filtra cada
   registro y no hay LIMIT; la lista se completa con los recientes.
   ============================================================ */

const ALPHA = 0.98;
const HOUR_WEIGHT = [1, 0.5, 0.2];
const EPSILON = 1e-9;

type HourScore = { hours: number[]; latest: number };
type HourScoreCache = { now: number; days: number; scores: Map<string, HourScore> };

/* Las puntuaciones por hora solo dependen de los registros, `now` y `days`:
   cambiar la hora pedida vuelve a ponderar a lo sumo cinco casillas. */
const hourScoreCache = new WeakMap<readonly MealLogDoc[], HourScoreCache>();

function chileDay(epochMs: number): number {
  const p = chileDateParts(epochMs);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY);
}

function hourScores(logs: readonly MealLogDoc[], now: number, days: number): Map<string, HourScore> {
  const cached = hourScoreCache.get(logs);
  if (cached && cached.now === now && cached.days === days) return cached.scores;
  const since = now - days * DAY, today = chileDay(now);
  const scores = new Map<string, HourScore>();
  for (const log of logs) {
    if (log._deleted || !log.templateId || log.consumedAt < since) continue;
    let score = scores.get(log.templateId);
    if (!score) { score = { hours: new Array<number>(24).fill(0), latest: log.consumedAt }; scores.set(log.templateId, score); }
    score.hours[chileDateParts(log.consumedAt).hour] += ALPHA ** Math.max(0, today - chileDay(log.consumedAt));
    score.latest = Math.max(score.latest, log.consumedAt);
  }
  hourScoreCache.set(logs, { now, days, scores });
  return scores;
}

/**
 * Alimentos que se suelen registrar cerca de `targetTime` (HH:MM, hora de
 * Chile), seguidos de los recientes que no entraron. Una hora invalida
 * devuelve solo los recientes.
 */
export function suggestedTemplatesForTime(
  logs: readonly MealLogDoc[], templates: readonly MealTemplateDoc[], targetTime: string, now: number, days = 90,
): MealTemplateDoc[] {
  const recents = recentTemplates(logs, templates, now);
  const match = /^([01]\d|2[0-3]):[0-5]\d$/.exec(targetTime);
  if (!match) return recents;
  const target = Number(match[1]);
  const byId = live(templates);
  const ranked: { template: MealTemplateDoc; score: number; latest: number }[] = [];
  for (const [id, { hours, latest }] of hourScores(logs, now, days)) {
    const template = byId.get(id);
    if (!template) continue;
    let score = 0;
    for (let hour = 0; hour < 24; hour++) {
      if (!hours[hour]) continue;
      const distance = Math.min(Math.abs(hour - target), 24 - Math.abs(hour - target));
      if (distance < HOUR_WEIGHT.length) score += hours[hour] * HOUR_WEIGHT[distance];
    }
    if (score > 0) ranked.push({ template, score, latest });
  }
  ranked.sort((a, b) => (Math.abs(b.score - a.score) > EPSILON ? b.score - a.score : 0)
    || b.latest - a.latest || a.template.id.localeCompare(b.template.id));
  const head = ranked.map(r => r.template);
  const seen = new Set(head.map(t => t.id));
  return [...head, ...recents.filter(t => !seen.has(t.id))];
}

/** Cantidad registrada como texto de entrada: hasta dos decimales y coma decimal. */
export function formatEnteredQuantity(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? String(rounded).replace('.', ',') : null;
}

/** Porcion ('' = unidad canonica) y cantidad con que se precarga un alimento. */
export type LastPortion = { portionId: string; quantity: string };

function defaultPortion(template: MealTemplateDoc): LastPortion {
  const portion = template.details.portions[0];
  return portion ? { portionId: portion.id, quantity: '1' } : { portionId: '', quantity: '100' };
}

function resolvePortion(log: MealLogDoc, template: MealTemplateDoc): LastPortion {
  const quantity = formatEnteredQuantity(log.entry?.enteredQuantity);
  if (quantity === null) return defaultPortion(template);
  const snapshot = log.entry.portionSnapshot;
  if (snapshot) {
    // Registros sin portionId (p. ej. importados) caen a la porcion por defecto.
    const portionId = snapshot.portionId;
    return portionId && template.details.portions.some(p => p.id === portionId) ? { portionId, quantity } : defaultPortion(template);
  }
  return log.nutritionSnapshot?.canonicalUnit === template.details.canonicalUnit ? { portionId: '', quantity } : defaultPortion(template);
}

/**
 * Ultima porcion y cantidad registradas por alimento vivo de la biblioteca.
 * Usa el registro mas nuevo (consumedAt, luego updatedAt); si ya no calza con
 * la plantilla, cae a la porcion por defecto sin buscar registros anteriores.
 */
export function lastLoggedPortions(logs: readonly MealLogDoc[], templates: readonly MealTemplateDoc[]): Map<string, LastPortion> {
  const byId = live(templates);
  const latest = new Map<string, MealLogDoc>();
  for (const log of logs) {
    if (log._deleted || !log.templateId || !byId.has(log.templateId)) continue;
    const current = latest.get(log.templateId);
    if (!current || log.consumedAt > current.consumedAt
      || (log.consumedAt === current.consumedAt && (log.updatedAt > current.updatedAt || (log.updatedAt === current.updatedAt && log.id > current.id))))
      latest.set(log.templateId, log);
  }
  const result = new Map<string, LastPortion>();
  for (const [id, log] of latest) result.set(id, resolvePortion(log, byId.get(id)!));
  return result;
}
