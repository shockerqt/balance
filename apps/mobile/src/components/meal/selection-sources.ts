import { toDateId } from '@/lib/dates';
import { isDateId, type MealLogDoc } from '@/services/sync/types';

/** Validate temporary UI selection against its canonical source snapshots. */
export function selectionSources(documents: MealLogDoc[], date: string, ids: string[], revisions?: Record<string, number>): MealLogDoc[] {
  if (!isDateId(date) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Vuelve a seleccionar los registros.');
  const byId = new Map(documents.map(doc => [doc.id, doc]));
  return ids.map(id => {
    const doc = byId.get(id);
    if (!doc || doc._deleted || toDateId(new Date(doc.consumedAt)) !== date || (revisions && revisions[id] !== doc.updatedAt))
      throw new Error('Los registros cambiaron. Vuelve a seleccionarlos.');
    return doc;
  });
}
