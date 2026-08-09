import { storage } from '../storage';
import { collectionStorageKey } from '../sync/sync-client';
import { MealLogDoc, MealTemplateDoc, isMealLogDoc, isMealTemplateDoc } from '../sync/types';

const JOURNAL_KEY = '@balance_import_journal_v1:guest';
const TEMPLATE_KEY = collectionStorageKey('guest', 'mealTemplates');
const LOG_KEY = collectionStorageKey('guest', 'mealLogs');

export interface GuestImportSnapshot {
  templates: MealTemplateDoc[];
  logs: MealLogDoc[];
}

export async function commitGuestImport(snapshot: GuestImportSnapshot): Promise<void> {
  const serialized = JSON.stringify(snapshot);
  await storage.setItem(JOURNAL_KEY, serialized);
  await storage.multiSet([
    [TEMPLATE_KEY, JSON.stringify(snapshot.templates)],
    [LOG_KEY, JSON.stringify(snapshot.logs)],
  ]);
  await storage.removeItem(JOURNAL_KEY);
}

export async function recoverGuestImport(): Promise<GuestImportSnapshot | null> {
  const journal = await storage.getItem(JOURNAL_KEY);
  if (!journal) return null;
  let snapshot: GuestImportSnapshot;
  try {
    const candidate = JSON.parse(journal) as Partial<GuestImportSnapshot>;
    if (
      !Array.isArray(candidate.templates) ||
      !candidate.templates.every(isMealTemplateDoc) ||
      !Array.isArray(candidate.logs) ||
      !candidate.logs.every(isMealLogDoc)
    ) {
      throw new Error('Invalid guest import journal');
    }
    snapshot = { templates: candidate.templates, logs: candidate.logs };
  } catch {
    await storage.removeItem(JOURNAL_KEY);
    return null;
  }
  await commitGuestImport(snapshot);
  return snapshot;
}
