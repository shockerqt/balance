import type { MealLogDoc, MealTemplateDoc } from '@/services/sync/types';

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
  return live.filter(t => fold(t.name).includes(text))
    .sort((a, b) => Number(!fold(a.name).startsWith(text)) - Number(!fold(b.name).startsWith(text)) || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit);
}
