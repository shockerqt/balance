import { chileDateParts } from '@/lib/dates';
import { storage } from '@/services/storage';
import { collectionStorageKey } from '@/services/sync/sync-client';
import { MealLogDoc, isMealLogDoc } from '@/services/sync/types';

export const MEAL_SHARD_PREFIX = '@balance_sync_meal_shards_v1:';
const MANIFEST_SUFFIX = ':manifest';
const MONTH_SEGMENT = ':month:';

export interface MealShardManifest {
  version: 1;
  complete: boolean;
  durable: boolean;
  months: string[];
  migration?: {
    status: 'in_progress' | 'complete';
    legacyKey: string;
    legacyDurable: boolean;
  };
}

export interface MealLogShard {
  version: 1;
  month: string;
  documents: MealLogDoc[];
}

export interface PriorityMealShardLoadResult {
  manifest: MealShardManifest | null;
  documents: MealLogDoc[];
  loadedMonths: Set<string>;
  remainingMonths: string[];
  complete: boolean;
  durable: boolean;
}

export interface RemainingMealShardLoadResult {
  documents: MealLogDoc[];
  valid: boolean;
  durable: boolean;
}

export function mealShardManifestKey(namespace: string): string {
  return `${MEAL_SHARD_PREFIX}${namespace || 'guest'}${MANIFEST_SUFFIX}`;
}

export function mealShardMonthKey(namespace: string, month: string): string {
  return `${MEAL_SHARD_PREFIX}${namespace || 'guest'}${MONTH_SEGMENT}${month}`;
}

export function mealLogMonth(consumedAt: number): string {
  const parts = chileDateParts(consumedAt);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function isMealShardManifest(value: unknown): value is MealShardManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<MealShardManifest>;
  return (
    candidate.version === 1 &&
    typeof candidate.complete === 'boolean' &&
    typeof candidate.durable === 'boolean' &&
    Array.isArray(candidate.months) &&
    candidate.months.every(isMonthKey)
  );
}

function isMealLogShard(value: unknown, expectedMonth: string): value is MealLogShard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<MealLogShard>;
  return (
    candidate.version === 1 &&
    candidate.month === expectedMonth &&
    Array.isArray(candidate.documents)
  );
}

async function readJson<T>(key: string): Promise<T | null> {
  if (typeof storage.getJsonItem === 'function') {
    return storage.getJsonItem<T>(key);
  }
  const raw = await storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  if (typeof storage.setJsonItem === 'function') {
    await storage.setJsonItem(key, value);
    return;
  }
  if (typeof storage.setItem === 'function') {
    await storage.setItem(key, JSON.stringify(value));
  }
}

async function removeJson(key: string): Promise<void> {
  if (typeof storage.removeJsonItem === 'function') {
    await storage.removeJsonItem(key);
    return;
  }
  if (typeof storage.removeItem === 'function') {
    await storage.removeItem(key);
  }
}

function isDurable(key: string): boolean {
  return typeof storage.isDurableItem === 'function' && storage.isDurableItem(key);
}

function groupByMonth(documents: readonly MealLogDoc[]): Map<string, MealLogDoc[]> {
  const grouped = new Map<string, MealLogDoc[]>();
  for (const doc of documents) {
    const month = mealLogMonth(doc.consumedAt);
    const bucket = grouped.get(month);
    if (bucket) bucket.push(doc);
    else grouped.set(month, [doc]);
  }
  return grouped;
}

function listsDiffer(a: readonly MealLogDoc[] | undefined, b: readonly MealLogDoc[] | undefined): boolean {
  if (!a || !b) return a !== b;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

async function ensureMigratedOrLoadManifest(namespace: string): Promise<{
  manifest: MealShardManifest | null;
  manifestDurable: boolean;
  migratedDocs: MealLogDoc[] | null;
}> {
  const manifestKey = mealShardManifestKey(namespace);
  const existing = await readJson<MealShardManifest>(manifestKey).catch(() => null);
  if (isMealShardManifest(existing) && existing.complete) {
    if (existing.migration?.legacyKey && typeof storage.getItem === 'function' && typeof storage.removeItem === 'function') {
      const leftover = await storage.getItem(existing.migration.legacyKey).catch(() => null);
      if (leftover !== null) {
        await storage.removeItem(existing.migration.legacyKey).catch(() => undefined);
      }
    }
    return {
      manifest: existing,
      manifestDurable: isDurable(manifestKey),
      migratedDocs: null,
    };
  }

  const legacyKey = collectionStorageKey(namespace, 'mealLogs');
  const raw = await storage.getItem(legacyKey).catch(() => null);
  const legacyDurable = isDurable(legacyKey);
  if (!raw) {
    return { manifest: null, manifestDurable: false, migratedDocs: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { manifest: null, manifestDurable: false, migratedDocs: null };
  }
  if (!Array.isArray(parsed)) {
    return { manifest: null, manifestDurable: false, migratedDocs: null };
  }

  const validDocs = parsed.filter(isMealLogDoc);
  const allValid = parsed.every(isMealLogDoc);
  const effectiveDurable = legacyDurable && allValid;
  const grouped = groupByMonth(validDocs);
  const months = Array.from(grouped.keys()).sort();

  await writeJson<MealShardManifest>(manifestKey, {
    version: 1,
    complete: false,
    durable: false,
    months,
    migration: {
      status: 'in_progress',
      legacyKey,
      legacyDurable: effectiveDurable,
    },
  });

  for (const [month, documents] of grouped) {
    await writeJson<MealLogShard>(mealShardMonthKey(namespace, month), {
      version: 1,
      month,
      documents,
    });
  }

  const completeManifest: MealShardManifest = {
    version: 1,
    complete: true,
    durable: effectiveDurable,
    months,
    migration: {
      status: 'complete',
      legacyKey,
      legacyDurable: effectiveDurable,
    },
  };
  await writeJson(manifestKey, completeManifest);
  const manifestDurable = isDurable(manifestKey);

  // Tombstone legacy key only after all shards and the completed manifest are durable.
  if (typeof storage.removeItem === 'function') {
    await storage.removeItem(legacyKey).catch(() => undefined);
  }

  return {
    manifest: completeManifest,
    manifestDurable,
    migratedDocs: validDocs,
  };
}

export async function loadPriorityMealLogShards(
  namespace: string,
  priorityMonths: readonly string[],
): Promise<PriorityMealShardLoadResult> {
  const { manifest, manifestDurable, migratedDocs } = await ensureMigratedOrLoadManifest(namespace);
  if (migratedDocs !== null && manifest) {
    return {
      manifest,
      documents: migratedDocs,
      loadedMonths: new Set(manifest.months),
      remainingMonths: [],
      complete: true,
      durable: manifest.durable && manifestDurable,
    };
  }
  if (!manifest) {
    return {
      manifest: null,
      documents: [],
      loadedMonths: new Set(),
      remainingMonths: [],
      complete: true,
      durable: false,
    };
  }

  const prioritySet = new Set(priorityMonths.filter(isMonthKey));
  const toLoadNow = manifest.months.filter((month) => prioritySet.has(month));
  const remainingMonths = manifest.months.filter((month) => !prioritySet.has(month)).sort().reverse();

  const loadedMonths = new Set<string>();
  const documents: MealLogDoc[] = [];
  let allValid = true;
  let allDurable = true;

  for (const month of toLoadNow) {
    const key = mealShardMonthKey(namespace, month);
    const shard = await readJson<MealLogShard>(key).catch(() => null);
    loadedMonths.add(month);
    if (!isMealLogShard(shard, month)) {
      allValid = false;
      allDurable = false;
      continue;
    }
    if (!isDurable(key)) allDurable = false;
    if (!shard.documents.every(isMealLogDoc)) allValid = false;
    for (const doc of shard.documents) {
      if (isMealLogDoc(doc)) documents.push(doc);
    }
  }

  return {
    manifest,
    documents,
    loadedMonths,
    remainingMonths,
    complete: remainingMonths.length === 0,
    durable: manifest.durable && manifestDurable && allValid && allDurable,
  };
}

export async function loadRemainingMealLogShards(
  namespace: string,
  remainingMonths: readonly string[],
): Promise<RemainingMealShardLoadResult> {
  const documents: MealLogDoc[] = [];
  let valid = true;
  let durable = true;

  for (const month of remainingMonths) {
    const key = mealShardMonthKey(namespace, month);
    const shard = await readJson<MealLogShard>(key).catch(() => null);
    if (!isMealLogShard(shard, month)) {
      valid = false;
      durable = false;
      continue;
    }
    if (!isDurable(key)) durable = false;
    if (!shard.documents.every(isMealLogDoc)) valid = false;
    for (const doc of shard.documents) {
      if (isMealLogDoc(doc)) documents.push(doc);
    }
  }

  return { documents, valid, durable };
}

export async function persistDirtyMealLogShards(
  namespace: string,
  previousDocs: readonly MealLogDoc[],
  nextDocs: readonly MealLogDoc[],
  options?: { loadedMonths?: ReadonlySet<string>; forceAll?: boolean; durable?: boolean },
): Promise<{ writtenMonths: string[]; durable: boolean }> {
  const manifestKey = mealShardManifestKey(namespace);
  const prevByMonth = groupByMonth(previousDocs);
  const nextByMonth = groupByMonth(nextDocs);

  const candidateMonths = new Set<string>([...prevByMonth.keys(), ...nextByMonth.keys()]);
  const dirtyMonths: string[] = [];
  for (const month of candidateMonths) {
    if (options?.loadedMonths && !options.loadedMonths.has(month)) continue;
    if (options?.forceAll || listsDiffer(prevByMonth.get(month), nextByMonth.get(month))) {
      dirtyMonths.push(month);
    }
  }
  dirtyMonths.sort();

  const existingManifest = await readJson<MealShardManifest>(manifestKey).catch(() => null);
  let nextMonths: string[];
  if (options?.loadedMonths && isMealShardManifest(existingManifest) && existingManifest.complete) {
    const merged = new Set(existingManifest.months.filter((month) => !options.loadedMonths!.has(month)));
    for (const month of nextByMonth.keys()) {
      if (options.loadedMonths.has(month)) merged.add(month);
    }
    nextMonths = Array.from(merged).sort();
  } else {
    nextMonths = Array.from(nextByMonth.keys())
      .filter((month) => !options?.loadedMonths || options.loadedMonths.has(month))
      .sort();
  }

  const targetDurable =
    options?.durable ??
    (options?.loadedMonths && isMealShardManifest(existingManifest) ? existingManifest.durable : true);

  const manifestNeedsWrite =
    !isMealShardManifest(existingManifest) ||
    !existingManifest.complete ||
    existingManifest.durable !== targetDurable ||
    existingManifest.months.length !== nextMonths.length ||
    existingManifest.months.some((month, index) => month !== nextMonths[index]);

  for (const month of dirtyMonths) {
    const docs = nextByMonth.get(month);
    const shardKey = mealShardMonthKey(namespace, month);
    if (docs && docs.length > 0) {
      await writeJson<MealLogShard>(shardKey, {
        version: 1,
        month,
        documents: docs,
      });
    } else {
      await removeJson(shardKey);
    }
  }

  if (manifestNeedsWrite || dirtyMonths.length > 0) {
    await writeJson<MealShardManifest>(manifestKey, {
      version: 1,
      complete: true,
      durable: targetDurable,
      months: nextMonths,
    });
  }

  return {
    writtenMonths: dirtyMonths,
    durable: isDurable(manifestKey),
  };
}

export async function replaceMealLogShards(
  namespace: string,
  documents: readonly MealLogDoc[],
): Promise<void> {
  const manifestKey = mealShardManifestKey(namespace);
  const existingManifest = await readJson<MealShardManifest>(manifestKey).catch(() => null);
  const grouped = groupByMonth(documents);
  const nextMonths = Array.from(grouped.keys()).sort();

  for (const [month, docs] of grouped) {
    await writeJson<MealLogShard>(mealShardMonthKey(namespace, month), {
      version: 1,
      month,
      documents: docs,
    });
  }

  if (isMealShardManifest(existingManifest)) {
    for (const oldMonth of existingManifest.months) {
      if (!grouped.has(oldMonth)) {
        await removeJson(mealShardMonthKey(namespace, oldMonth));
      }
    }
  }

  await writeJson<MealShardManifest>(manifestKey, {
    version: 1,
    complete: true,
    durable: true,
    months: nextMonths,
  });

  if (typeof storage.removeItem === 'function') {
    await storage.removeItem(collectionStorageKey(namespace, 'mealLogs')).catch(() => undefined);
  }
}
