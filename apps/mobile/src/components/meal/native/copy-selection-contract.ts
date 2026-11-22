import { chileTimeString, epochForChileDateTime, toDateId } from '@/lib/dates';
import { isDateId, isMealLogDoc, type MealLogDoc } from '@/services/sync/types';

export type SelectionCopyInput = {
  operationId: string;
  sourceDate: string;
  ids: string[];
  revisions: Record<string, number>;
  destinationDate: string;
  /** A non-empty HH:mm moves every copy to that time; omitted, null or empty keeps each original Chile time. */
  time?: string | null;
};

export type SelectionCopyPlan = {
  input: SelectionCopyInput;
  documents: MealLogDoc[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isCopyOperationId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

function fail(message: string): never { throw new Error(message); }

// This prepares one immutable local intention. Keep this plan for local retries:
// regenerating its IDs after a failed receipt could duplicate a durable write.
export function prepareSelectionCopy(
  input: SelectionCopyInput,
  documents: MealLogDoc[],
  nextId: () => string,
  now = Date.now(),
): SelectionCopyPlan {
  if (!isCopyOperationId(input.operationId) || !isDateId(input.sourceDate) ||
      !isDateId(input.destinationDate) || !Number.isSafeInteger(now) || now <= 0)
    return fail('Elige una fecha y hora válidas.');
  if (input.time !== undefined && input.time !== null && typeof input.time !== 'string')
    return fail('Elige una fecha y hora válidas.');
  const override = input.time ? input.time : null;
  let fixedConsumedAt: number | null = null;
  if (override !== null) {
    fixedConsumedAt = epochForChileDateTime(input.destinationDate, override);
    if (fixedConsumedAt === null || fixedConsumedAt <= 0)
      return fail('Esa fecha y hora no existen en el horario de Chile.');
  } else {
    // Validate the destination day itself before any source-specific hour.
    const midday = epochForChileDateTime(input.destinationDate, '12:00');
    if (midday === null || midday <= 0) return fail('Esa fecha no existe en el horario de Chile.');
  }
  if (!Array.isArray(input.ids) || !input.ids.length || new Set(input.ids).size !== input.ids.length ||
      !input.revisions || typeof input.revisions !== 'object' || Array.isArray(input.revisions) ||
      Object.keys(input.revisions).length !== input.ids.length)
    return fail('Vuelve a seleccionar los registros que quieres copiar.');

  const byId = new Map(documents.map(document => [document.id, document]));
  const sources = input.ids.map(id => {
    const source = byId.get(id);
    if (!source || !isMealLogDoc(source) || source._deleted ||
        !Number.isSafeInteger(source.updatedAt) || source.updatedAt <= 0 ||
        source.updatedAt !== input.revisions[id] || toDateId(new Date(source.consumedAt)) !== input.sourceDate)
      return fail('Los registros cambiaron. Vuelve a seleccionarlos antes de copiar.');
    return source;
  });
  // Resolve every destination instant before allocating any ID: one nonexistent
  // DST hour rejects the whole batch instead of producing a partial copy.
  const consumedAts = sources.map(source => {
    if (fixedConsumedAt !== null) return fixedConsumedAt;
    const time = chileTimeString(source.consumedAt);
    const consumedAt = epochForChileDateTime(input.destinationDate, time);
    if (consumedAt === null || consumedAt <= 0)
      return fail(`Las ${time} no existen el ${input.destinationDate} en el horario de Chile. Elige una hora.`);
    return consumedAt;
  });
  const allocated = new Set(byId.keys());
  const copies = sources.map((source, index) => {
    const id = nextId();
    if (!UUID.test(id) || allocated.has(id)) return fail('No se pudo preparar la copia. Reintenta.');
    allocated.add(id);
    // Clone the canonical document, not display totals or the current template.
    // JSON documents are already serialization-safe; this also separates every
    // nested snapshot so later local edits cannot mutate the original.
    const copy = JSON.parse(JSON.stringify(source)) as MealLogDoc;
    delete copy.provenance;
    copy.id = id;
    copy.consumedAt = consumedAts[index];
    copy.updatedAt = now;
    copy._deleted = false;
    copy.copySource = { id: source.id, updatedAt: source.updatedAt };
    return copy;
  });
  return { input: { ...input, ids: [...input.ids], revisions: { ...input.revisions } }, documents: copies };
}

export function selectionCopyPlanIsCurrent(plan: SelectionCopyPlan, documents: MealLogDoc[]): boolean {
  const byId = new Map(documents.map(document => [document.id, document]));
  return plan.input.ids.every(id => {
    const source = byId.get(id);
    return !!source && !source._deleted && source.updatedAt === plan.input.revisions[id] &&
      toDateId(new Date(source.consumedAt)) === plan.input.sourceDate;
  });
}
