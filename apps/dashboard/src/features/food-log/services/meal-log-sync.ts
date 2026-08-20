import type { MealLogDoc, MealTemplateDoc } from '../../../types/meal-log.ts';

export interface MealLogPersistenceChangeSet {
  documents: MealLogDoc[];
  pushDocuments: MealLogDoc[];
  replacedIds: Record<string, string>;
}

function withoutUpdatedAt(document: MealLogDoc): Omit<MealLogDoc, 'updatedAt'> {
  const { updatedAt: _updatedAt, ...rest } = document;
  return rest;
}

function sameDocumentContent(left: MealLogDoc, right: MealLogDoc): boolean {
  return JSON.stringify(withoutUpdatedAt(left)) === JSON.stringify(withoutUpdatedAt(right));
}

export function mergeMealLogs(previous: MealLogDoc[], incoming: MealLogDoc[]): MealLogDoc[] {
  const byId = new Map(previous.map((document) => [document.id, document]));
  for (const document of incoming) {
    const current = byId.get(document.id);
    if (!current || document.updatedAt >= current.updatedAt) byId.set(document.id, document);
  }
  return Array.from(byId.values());
}

export function mergeMealTemplates(previous: MealTemplateDoc[], incoming: MealTemplateDoc[]): MealTemplateDoc[] {
  const byId = new Map(previous.map((document) => [document.id, document]));
  for (const document of incoming) {
    const current = byId.get(document.id);
    if (!current || document.updatedAt >= current.updatedAt) byId.set(document.id, document);
  }
  return Array.from(byId.values());
}

/**
 * Converts command-engine document snapshots into monotonic sync mutations.
 *
 * Undo/redo can restore an older `updatedAt`, and undoing a create can remove a
 * document from the command snapshot entirely. The remote sync protocol is LWW,
 * so the adapter must re-stamp semantic changes and turn removals into canonical
 * tombstones before they cross the persistence boundary.
 *
 * The server deliberately does not mutate `templateId` on an existing meal log.
 * A terminal food replacement is therefore materialized as a tombstone for the
 * old log plus a fresh log identity for the newly selected template.
 */
export function materializeMealLogChanges(
  before: MealLogDoc[],
  after: MealLogDoc[],
  now = Date.now(),
  createId = () => crypto.randomUUID(),
): MealLogPersistenceChangeSet {
  const beforeById = new Map(before.map((document) => [document.id, document]));
  const afterIds = new Set(after.map((document) => document.id));
  const documents: MealLogDoc[] = [];
  const pushDocuments: MealLogDoc[] = [];
  const replacedIds: Record<string, string> = {};
  let clock = now;

  const freshTimestamp = (...minimums: number[]) => {
    const value = Math.max(clock, ...minimums);
    clock = value + 1;
    return value;
  };

  for (const candidate of after) {
    const previous = beforeById.get(candidate.id);
    if (previous && sameDocumentContent(previous, candidate)) {
      documents.push({ ...candidate, updatedAt: previous.updatedAt });
      continue;
    }

    if (previous && previous.templateId !== candidate.templateId && !candidate._deleted) {
      const tombstone: MealLogDoc = {
        ...previous,
        _deleted: true,
        updatedAt: freshTimestamp(previous.updatedAt + 1, candidate.updatedAt),
      };
      const replacement: MealLogDoc = {
        ...candidate,
        id: createId(),
        updatedAt: freshTimestamp(candidate.updatedAt),
      };
      replacedIds[candidate.id] = replacement.id;
      documents.push(tombstone, replacement);
      pushDocuments.push(tombstone, replacement);
      continue;
    }

    const updatedAt = freshTimestamp(candidate.updatedAt, previous ? previous.updatedAt + 1 : candidate.updatedAt);
    const materialized = { ...candidate, updatedAt };
    documents.push(materialized);
    pushDocuments.push(materialized);
  }

  for (const previous of before) {
    if (afterIds.has(previous.id)) continue;
    if (previous._deleted) {
      documents.push(previous);
      continue;
    }
    const tombstone = {
      ...previous,
      _deleted: true,
      updatedAt: freshTimestamp(previous.updatedAt + 1),
    };
    documents.push(tombstone);
    pushDocuments.push(tombstone);
  }

  return { documents, pushDocuments, replacedIds };
}
