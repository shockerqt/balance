const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const ts = local('typescript');

const filePath = key => `file:///documents/balance-sync-v1/${crypto.createHash('sha256').update(key).digest('hex')}.json`;

function createHarness(platform = 'android') {
  const files = new Map();
  const legacy = new Map();
  const web = new Map();
  const writes = [];
  const deletes = [];
  const controls = {};

  const asyncStorage = {
    async getItem(key) { return legacy.get(key) ?? null; },
    async setItem(key, value) { legacy.set(key, value); },
    async removeItem(key) { legacy.delete(key); },
    async multiSet(entries) { for (const [k, v] of entries) legacy.set(k, v); },
  };

  const fileSystem = {
    documentDirectory: 'file:///documents/',
    EncodingType: { UTF8: 'utf8' },
    async getInfoAsync(uri) { return { exists: files.has(uri) }; },
    async makeDirectoryAsync() {},
    async readAsStringAsync(uri) {
      if (!files.has(uri)) throw new Error('Missing file');
      return files.get(uri);
    },
    async writeAsStringAsync(uri, value) {
      await controls.beforeWrite?.(uri, value);
      files.set(uri, value);
      writes.push({ uri, value });
    },
    async moveAsync({ from, to }) {
      await controls.beforeMove?.(from, to);
      assert.ok(files.has(from));
      files.set(to, files.get(from));
      files.delete(from);
      writes.push({ uri: to, value: files.get(to), movedFrom: from });
    },
    async deleteAsync(uri) {
      files.delete(uri);
      deletes.push(uri);
    },
  };

  const modules = new Map();
  function load(filename) {
    const full = [filename, `${filename}.ts`, `${filename}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!full) return local(filename);
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} };
    modules.set(full, module);
    const globals = {
      'react-native': { Platform: { OS: platform }, AppState: { addEventListener: () => ({ remove() {} }) } },
      '@react-native-async-storage/async-storage': { default: asyncStorage, ...asyncStorage },
      'expo-file-system/legacy': fileSystem,
      'expo-crypto': {
        CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
        randomUUID: crypto.randomUUID,
        digestStringAsync: async (_, value) => crypto.createHash('sha256').update(value).digest('hex'),
      },
      '@/services/config': { API_BASE_URL: 'https://fixture.invalid/api', WS_SYNC_URL: 'wss://fixture.invalid/sync', WS_AUTH_MODE: 'application' },
      '@/services/auth/session-state': { authDataNamespace: (api, id) => `user:${id}`, accessTokenChanged: () => {} },
    };
    const requireFrom = name => {
      if (name in globals) return globals[name];
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return local(name);
    };
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      fileName: full,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: requireFrom,
      console,
      Intl,
      JSON,
      setTimeout,
      clearTimeout,
      setImmediate,
      URL,
      TextEncoder,
      TextDecoder,
      window: platform === 'web' ? { localStorage: { getItem: k => web.get(k) ?? null, setItem: (k, v) => web.set(k, v), removeItem: k => web.delete(k) } } : undefined,
    }, { filename: full });
    return module.exports;
  }

  const dates = load(path.join(root, 'src/lib/dates.ts'));
  const storage = load(path.join(root, 'src/services/storage.ts')).storage;
  const shards = load(path.join(root, 'src/services/storage/meal-log-shards.ts'));
  const syncClient = load(path.join(root, 'src/services/sync/sync-client.ts'));
  return { files, legacy, web, writes, deletes, controls, dates, storage, shards, syncClient };
}

const meal = (id, consumedAt, updatedAt = 1000) => ({
  id,
  templateId: null,
  nameSnapshot: `Meal ${id}`,
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 5, carbs: 10, fat: 2 } },
  canonicalQuantity: 100,
  entry: { enteredQuantity: 100 },
  consumedAt,
  updatedAt,
  _deleted: false,
});

const plain = value => JSON.parse(JSON.stringify(value));

test('Chile YYYY-MM sharding and single-pass direct-JSON encoding', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  // 2026-04-01T02:30:00Z is 2026-03-31 23:30 in Chile (America/Santiago, UTC-3)
  const marchEnd = Date.UTC(2026, 3, 1, 2, 30, 0);
  // 2026-04-01T04:00:00Z is 2026-04-01 01:00 in Chile
  const aprilStart = Date.UTC(2026, 3, 1, 4, 0, 0);
  const docs = [meal('m1', marchEnd), meal('m2', aprilStart)];

  const result = await h.shards.persistDirtyMealLogShards(ns, [], docs);
  assert.deepEqual(plain(result.writtenMonths), ['2026-03', '2026-04']);
  assert.equal(result.durable, true);

  // Verify direct JSON without double encoding ({ version: 1, value: "..." })
  const marchUri = filePath(h.shards.mealShardMonthKey(ns, '2026-03'));
  const rawMarch = h.files.get(marchUri);
  assert.ok(rawMarch);
  const parsedMarch = JSON.parse(rawMarch);
  assert.equal(parsedMarch.version, 1);
  assert.equal(parsedMarch.month, '2026-03');
  assert.equal('value' in parsedMarch, false, 'must not double-encode JSON inside { version: 1, value }');
  assert.deepEqual(parsedMarch.documents.map(d => d.id), ['m1']);

  const manifestUri = filePath(h.shards.mealShardManifestKey(ns));
  const parsedManifest = JSON.parse(h.files.get(manifestUri));
  assert.equal(parsedManifest.version, 1);
  assert.equal(parsedManifest.complete, true);
  assert.equal(parsedManifest.durable, true);
  assert.deepEqual(parsedManifest.months, ['2026-03', '2026-04']);
  assert.equal('value' in parsedManifest, false);
});

test('dirty-shard-only persistence skips untouched months and handles cross-month moves and deletions', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const jan = meal('d-jan', h.dates.epochForChileDateTime('2026-01-15', '12:00'));
  const feb = meal('d-feb', h.dates.epochForChileDateTime('2026-02-15', '12:00'));
  const mar = meal('d-mar', h.dates.epochForChileDateTime('2026-03-15', '12:00'));
  const initial = [jan, feb, mar];

  await h.shards.persistDirtyMealLogShards(ns, [], initial);
  h.writes.length = 0;
  h.deletes.length = 0;

  // Edit only March document
  const marEdited = { ...mar, nameSnapshot: 'Edited March', updatedAt: 2000 };
  const afterEdit = [jan, feb, marEdited];
  const editRes = await h.shards.persistDirtyMealLogShards(ns, initial, afterEdit);
  assert.deepEqual(plain(editRes.writtenMonths), ['2026-03']);
  assert.equal(h.writes.some(w => w.uri === filePath(h.shards.mealShardMonthKey(ns, '2026-01'))), false);
  assert.equal(h.writes.some(w => w.uri === filePath(h.shards.mealShardMonthKey(ns, '2026-02'))), false);

  // Move February document into March -> 2026-02 becomes empty and is deleted, 2026-03 is updated
  h.writes.length = 0;
  h.deletes.length = 0;
  const febMoved = { ...feb, consumedAt: h.dates.epochForChileDateTime('2026-03-20', '13:00'), updatedAt: 3000 };
  const afterMove = [jan, febMoved, marEdited];
  const moveRes = await h.shards.persistDirtyMealLogShards(ns, afterEdit, afterMove);
  assert.deepEqual(plain(moveRes.writtenMonths), ['2026-02', '2026-03']);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-02'))), false);
  assert.ok(h.deletes.includes(filePath(h.shards.mealShardMonthKey(ns, '2026-02'))));

  const priority = await h.shards.loadPriorityMealLogShards(ns, ['2026-03']);
  assert.deepEqual(plain(priority.manifest.months), ['2026-01', '2026-03']);
  assert.deepEqual(plain(priority.documents.map(d => d.id).sort()), ['d-feb', 'd-mar']);
  assert.deepEqual(plain(priority.remainingMonths), ['2026-01']);

  const remaining = await h.shards.loadRemainingMealLogShards(ns, priority.remainingMonths);
  assert.deepEqual(plain(remaining.documents.map(d => d.id)), ['d-jan']);
  assert.equal(remaining.valid, true);
  assert.equal(remaining.durable, true);
});

test('atomic resumable legacy migration preserves legacy key on interruption and tombstones only after completion', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const legacyKey = h.syncClient.collectionStorageKey(ns, 'mealLogs');
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  const feb = meal('m-feb', h.dates.epochForChileDateTime('2026-02-10', '10:00'));
  await h.storage.setItem(legacyKey, JSON.stringify([jan, feb]));

  // Interrupt during 2026-02 shard write
  const febUri = filePath(h.shards.mealShardMonthKey(ns, '2026-02'));
  h.controls.beforeWrite = uri => {
    if (uri === febUri) throw new Error('Simulated crash mid-migration');
  };
  await assert.rejects(() => h.shards.loadPriorityMealLogShards(ns, ['2026-02']), /SYNC_STORAGE_WRITE_FAILED/);

  // Legacy key must still exist and manifest must not be complete
  assert.ok(await h.storage.getItem(legacyKey));
  const partialManifest = JSON.parse(h.files.get(filePath(h.shards.mealShardManifestKey(ns))));
  assert.equal(partialManifest.complete, false);
  assert.equal(partialManifest.migration.status, 'in_progress');

  // Resume without fault
  h.controls.beforeWrite = undefined;
  const resumed = await h.shards.loadPriorityMealLogShards(ns, ['2026-02']);
  assert.equal(resumed.complete, true);
  assert.equal(resumed.durable, true);
  assert.equal(resumed.documents.length, 2);
  assert.equal(await h.storage.getItem(legacyKey), null, 'legacy key tombstoned after completed manifest');
});

test('AsyncStorage-only legacy cache migrates with durable=false provenance so canResume stays false', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const legacyKey = h.syncClient.collectionStorageKey(ns, 'mealLogs');
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  h.legacy.set(legacyKey, JSON.stringify([jan]));

  const loaded = await h.shards.loadPriorityMealLogShards(ns, ['2026-01']);
  assert.equal(loaded.documents.length, 1);
  assert.equal(loaded.complete, true);
  assert.equal(loaded.durable, false, 'non-durable AsyncStorage origin must not certify durable=true');
  assert.equal(await h.storage.getItem(legacyKey), null, 'durable null tombstone blocks AsyncStorage resurrection');
});

test('single-shard corruption or missing file degrades validity/durability while preserving intact shards', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  const feb = meal('m-feb', h.dates.epochForChileDateTime('2026-02-10', '10:00'));
  const mar = meal('m-mar', h.dates.epochForChileDateTime('2026-03-10', '10:00'));
  await h.shards.persistDirtyMealLogShards(ns, [], [jan, feb, mar]);

  // Corrupt February shard and delete January shard
  h.files.set(filePath(h.shards.mealShardMonthKey(ns, '2026-02')), '{corrupt-json');
  h.files.delete(filePath(h.shards.mealShardMonthKey(ns, '2026-01')));

  const priority = await h.shards.loadPriorityMealLogShards(ns, ['2026-03', '2026-02']);
  assert.equal(priority.durable, false);
  assert.deepEqual(plain(priority.documents.map(d => d.id)), ['m-mar']);
  assert.deepEqual(plain(priority.remainingMonths), ['2026-01']);

  const remaining = await h.shards.loadRemainingMealLogShards(ns, priority.remainingMonths);
  assert.equal(remaining.valid, false);
  assert.equal(remaining.durable, false);
  assert.deepEqual(plain(remaining.documents), []);
});

test('replaceMealLogShards replaces shards, removes stale months, and tombstones legacy key', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const legacyKey = h.syncClient.collectionStorageKey(ns, 'mealLogs');
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  const feb = meal('m-feb', h.dates.epochForChileDateTime('2026-02-10', '10:00'));
  const mar = meal('m-mar', h.dates.epochForChileDateTime('2026-03-10', '10:00'));
  await h.storage.setItem(legacyKey, JSON.stringify([jan]));
  await h.shards.persistDirtyMealLogShards(ns, [], [jan, feb]);

  await h.shards.replaceMealLogShards(ns, [mar]);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-01'))), false);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-02'))), false);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-03'))), true);
  assert.equal(await h.storage.getItem(legacyKey), null);

  const loaded = await h.shards.loadPriorityMealLogShards(ns, ['2026-03']);
  assert.deepEqual(plain(loaded.manifest.months), ['2026-03']);
  assert.deepEqual(plain(loaded.documents.map(d => d.id)), ['m-mar']);
  assert.equal(loaded.durable, true);
});

test('web localStorage backend supports shard persistence and two-phase loading', async () => {
  const h = createHarness('web');
  const ns = 'user:web';
  const jan = meal('w-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  const mar = meal('w-mar', h.dates.epochForChileDateTime('2026-03-10', '10:00'));
  await h.shards.persistDirtyMealLogShards(ns, [], [jan, mar]);

  assert.ok(h.web.has(h.shards.mealShardManifestKey(ns)));
  const priority = await h.shards.loadPriorityMealLogShards(ns, ['2026-03']);
  assert.deepEqual(plain(priority.documents.map(d => d.id)), ['w-mar']);
  const remaining = await h.shards.loadRemainingMealLogShards(ns, priority.remainingMonths);
  assert.deepEqual(plain(remaining.documents.map(d => d.id)), ['w-jan']);
});

test('post-manifest tombstone crash window removes leftover legacy key on next load', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const legacyKey = h.syncClient.collectionStorageKey(ns, 'mealLogs');
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  await h.storage.setItem(legacyKey, JSON.stringify([jan]));

  // Simulate crash right after writing complete manifest, before removeItem(legacyKey)
  await h.storage.setJsonItem(h.shards.mealShardMonthKey(ns, '2026-01'), {
    version: 1,
    month: '2026-01',
    documents: [jan],
  });
  await h.storage.setJsonItem(h.shards.mealShardManifestKey(ns), {
    version: 1,
    complete: true,
    durable: true,
    months: ['2026-01'],
    migration: { status: 'complete', legacyKey, legacyDurable: true },
  });
  assert.ok(await h.storage.getItem(legacyKey));

  const loaded = await h.shards.loadPriorityMealLogShards(ns, ['2026-01']);
  assert.equal(loaded.documents.length, 1);
  assert.equal(await h.storage.getItem(legacyKey), null, 'leftover legacy key is cleaned up');
});

test('partial loadedMonths protects unloaded shards and preserves manifest durability', async () => {
  const h = createHarness('ios');
  const ns = 'user:1';
  const jan = meal('m-jan', h.dates.epochForChileDateTime('2026-01-10', '10:00'));
  const mar = meal('m-mar', h.dates.epochForChileDateTime('2026-03-10', '10:00'));
  const mar2 = meal('m-mar-2', h.dates.epochForChileDateTime('2026-03-11', '12:00'));
  const febUnloaded = meal('m-feb', h.dates.epochForChileDateTime('2026-02-10', '10:00'));
  await h.shards.persistDirtyMealLogShards(ns, [], [jan, mar], { durable: false });
  h.writes.length = 0;
  h.deletes.length = 0;

  const res = await h.shards.persistDirtyMealLogShards(ns, [mar], [mar, mar2, febUnloaded], {
    loadedMonths: new Set(['2026-03']),
  });
  assert.deepEqual(plain(res.writtenMonths), ['2026-03']);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-01'))), true);
  assert.equal(h.files.has(filePath(h.shards.mealShardMonthKey(ns, '2026-02'))), false, 'unloaded month not written');
  const manifest = await h.storage.getJsonItem(h.shards.mealShardManifestKey(ns));
  assert.deepEqual(plain(manifest.months), ['2026-01', '2026-03']);
  assert.equal(manifest.durable, false, 'existing manifest durability preserved when omitted');
});
