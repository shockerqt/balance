const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const api = 'https://fixture.invalid/api';
const identity = local('./src/services/auth/session-state.ts');
const namespace = identity.authDataNamespace(api, 1);
const cursorKey = `@balance_sync_checkpoint_v2:${namespace}:mealLogs`;
const outboxKey = `@balance_sync_outbox_v2:${namespace}`;
const filePath = key => `file:///documents/balance-sync-v1/${crypto.createHash('sha256').update(key).digest('hex')}.json`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const meal = (n, updatedAt = 1000) => ({
  id: uuid(n), templateId: null, nameSnapshot: 'Synthetic history '.repeat(11),
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 1 } },
  canonicalQuantity: 100, entry: { enteredQuantity: 100 }, consumedAt: 1700000000000 + n, updatedAt, _deleted: false,
});
const checkpoint = doc => ({ updatedAt: doc.updatedAt, id: String(doc.id) });

function disk() {
  const files = new Map(), legacy = new Map(), controls = {};
  const native = {
    async getItem(key) {
      const value = legacy.get(key) ?? null;
      if (value && Buffer.byteLength(value) > 2 * 1024 * 1024) throw Error('Synthetic CursorWindow limit');
      return value;
    },
    async setItem(key, value) {
      const total = [...legacy.entries()].reduce((n, [k, v]) => n + (k === key ? 0 : Buffer.byteLength(v)), 0) + Buffer.byteLength(value);
      if (total > 6 * 1024 * 1024) throw Error('Synthetic SQLite size limit');
      legacy.set(key, value);
    },
    async removeItem(key) { legacy.delete(key); },
    async multiSet(entries) { for (const [key, value] of entries) await native.setItem(key, value); },
  };
  const fileSystem = {
    documentDirectory: 'file:///documents/', EncodingType: { UTF8: 'utf8' },
    async getInfoAsync(uri) { return { exists: files.has(uri) }; },
    async makeDirectoryAsync() {},
    async readAsStringAsync(uri) { if (!files.has(uri)) throw Error('Missing file'); return files.get(uri); },
    async writeAsStringAsync(uri, value) { await controls.beforeWrite?.(uri, value); files.set(uri, value); },
    async moveAsync({ from, to }) { await controls.beforeMove?.(from, to); assert.ok(files.has(from)); files.set(to, files.get(from)); files.delete(from); },
    async deleteAsync(uri) { files.delete(uri); },
  };
  return { files, legacy, controls, native, fileSystem };
}

// Recreate every application module on each launch; only physical backends and
// the synthetic server survive. Storage, client and all four providers are real.
function launch(physical, serverMeals = []) {
  const modules = new Map(), sockets = [], server = { userPreferences: [{ id: '1', preferences: { weightTrackingEnabled: true }, updatedAt: 1000, _deleted: false }], mealTemplates: [], mealLogs: serverMeals, weightLogs: [] };
  let user = { id: 1 }, view, stores = {};
  class Socket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 0; frames = []; answered = new Set();
    constructor() { sockets.push(this); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const native = { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } };
  const globals = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': native,
    '@react-native-async-storage/async-storage': { default: physical.native, ...physical.native },
    'expo-file-system/legacy': physical.fileSystem,
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: crypto.randomUUID, digestStringAsync: async (_, value) => crypto.createHash('sha256').update(value).digest('hex') },
    '@/services/config': { API_BASE_URL: api, WS_SYNC_URL: 'wss://fixture.invalid/sync', WS_AUTH_MODE: 'application' },
    '@/hooks/use-auth': { useAuth: () => ({ user, isGuest: false }) },
    '@/services/import/guest-import': { recoverGuestImport: async () => null },
    '@/services/sync/official-templates': { fetchOfficialTemplates: async () => [] },
  };
  function load(filename) {
    const full = [filename, `${filename}.ts`, `${filename}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!full) return local(filename);
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} }; modules.set(full, module);
    const requireFrom = name => {
      if (name === './use-auth') return globals['@/hooks/use-auth'];
      if (name in globals) return globals[name];
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return local(name);
    };
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { fileName: full, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, WebSocket: Socket, console,
      setTimeout: () => 1, clearTimeout() {}, setImmediate, URL, TextEncoder, TextDecoder }, { filename: full });
    return module.exports;
  }
  const storage = load(path.join(root, 'src/services/storage.ts')).storage;
  const owner = load(path.join(root, 'src/services/sync/sync-client.ts'));
  const client = owner.syncClient;
  const preferences = load(path.join(root, 'src/hooks/use-preferences-store.tsx'));
  const weights = load(path.join(root, 'src/hooks/use-weight-store.tsx'));
  const meals = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const library = load(path.join(root, 'src/hooks/use-food-library-store.tsx'));
  function Probe() {
    stores = { meals: meals.useMealStore(), weights: weights.useWeightStore(), preferences: preferences.usePreferencesStore(), library: library.useFoodLibraryStore() };
    return null;
  }
  const tree = () => React.createElement(preferences.PreferencesProvider, null,
    React.createElement(weights.WeightProvider, null, React.createElement(meals.MealStoreProvider, null,
      React.createElement(library.FoodLibraryProvider, null, React.createElement(Probe)))));
  async function mount() {
    client.setNamespace(namespace);
    await renderer.act(async () => { view = renderer.create(tree()); await tick(); });
  }
  async function connect() {
    await renderer.act(async () => {
      client.connect('synthetic-token', namespace);
      const socket = sockets.at(-1); socket.readyState = 1; socket.onopen?.(); socket.receive({ event: 'authenticated' }); await tick();
    });
  }
  async function pump(stop = () => client.getStatusSnapshot().phase === 'synced') {
    for (let turn = 0; turn < 1200; turn++) {
      await renderer.act(async () => {
        const socket = sockets.at(-1);
        for (const frame of socket?.frames ?? []) {
          if (!['pull', 'push'].includes(frame.event) || socket.answered.has(frame.requestId)) continue;
          socket.answered.add(frame.requestId);
          if (frame.event === 'push') {
            const values = new Map(server[frame.collection].map(doc => [doc.id, doc]));
            for (const row of frame.rows) values.set(row.newDocumentState.id, row.newDocumentState);
            server[frame.collection] = [...values.values()];
            socket.receive({ event: 'push_response', requestId: frame.requestId, collection: frame.collection, conflicts: [], rejections: [] });
            socket.receive({ event: 'collection_changed', collection: frame.collection });
          } else {
            assert.deepEqual(Object.keys(frame.checkpoint ?? {}).sort(), frame.checkpoint ? ['id', 'updatedAt'] : []);
            const pending = server[frame.collection].filter(doc => !frame.checkpoint || doc.updatedAt > frame.checkpoint.updatedAt || (doc.updatedAt === frame.checkpoint.updatedAt && String(doc.id) > frame.checkpoint.id));
            pending.sort((a, b) => a.updatedAt - b.updatedAt || String(a.id).localeCompare(String(b.id)));
            const documents = pending.slice(0, frame.limit);
            socket.receive({ event: 'pull_response', requestId: frame.requestId, collection: frame.collection, documents, checkpoint: documents.length ? checkpoint(documents.at(-1)) : null, hasMoreDocuments: pending.length > documents.length });
          }
        }
        await tick();
      });
      if (stop()) return;
    }
    assert.fail(`Owner did not settle: ${JSON.stringify(client.getStatusSnapshot())}`);
  }
  async function close() {
    await renderer.act(async () => { client.disconnect(); view?.unmount(); await tick(); });
  }
  return { storage, client, owner, server, sockets, mount, connect, pump, close, get stores() { return stores; } };
}

test('real storage + four providers + owner recover large legacy partial history and pending edits, then survive a cold restart', async () => {
  const physical = disk(), history = Array.from({ length: 4500 }, (_, i) => meal(i + 1));
  const first = launch(physical, history);
  const cacheKey = first.owner.collectionStorageKey(namespace, 'mealLogs');
  assert.ok(Buffer.byteLength(JSON.stringify(history)) > 2 * 1024 * 1024, 'fixture exceeds real Android entry-read limit');
  physical.legacy.set(cacheKey, JSON.stringify(history.slice(0, 2)));
  physical.legacy.set(cursorKey, JSON.stringify(checkpoint(history.at(-1))));
  const pending = meal(9000, 2000);
  physical.legacy.set(outboxKey, JSON.stringify([{ collection: 'mealLogs', document: pending, previousDocument: null, queuedAt: 1 }]));
  physical.legacy.set('unrelated-auth-metadata', 'unchanged');
  await first.mount(); await first.connect(); await first.pump();
  assert.equal(first.sockets[0].frames.find(frame => frame.event === 'pull' && frame.collection === 'mealLogs').checkpoint, null);
  assert.equal(first.stores.meals.mealDocuments.length, 4501);
  assert.equal(first.stores.meals.mealDocuments.some(doc => doc.id === pending.id), true);
  assert.equal(JSON.parse(await first.storage.getItem(outboxKey)).length, 0);
  assert.equal(JSON.parse(await first.storage.getItem(cursorKey)).cacheVersion, 1);
  assert.equal(physical.legacy.get('unrelated-auth-metadata'), 'unchanged');
  const complete = first.server.mealLogs;
  await first.close();
  const restarted = launch(physical, complete);
  await restarted.mount();
  assert.equal(restarted.stores.meals.mealDocuments.length, 4501, 'fresh providers hydrate disk, not previous process RAM');
  await restarted.connect(); await restarted.pump();
  assert.equal(restarted.client.getStatusSnapshot().receivedDocuments, 0);
  assert.equal(restarted.stores.meals.mealDocuments.length, 4501, 'zero new records does not remove cached history');
  await restarted.close();
});

test('local save before reconnect invalidates an orphan versioned cursor before replacing missing cache', async () => {
  const physical = disk(), history = Array.from({ length: 101 }, (_, i) => meal(i + 1));
  const first = launch(physical, history);
  await first.storage.setItem(cursorKey, JSON.stringify({ ...checkpoint(history.at(-1)), cacheVersion: 1 }));
  await first.mount();
  const pending = meal(9001, 3000);
  await renderer.act(async () => { await first.stores.meals.registerMealLog(pending); await tick(); });
  assert.equal(await first.storage.getItem(cursorKey), null);
  await first.close();
  const restarted = launch(physical, history);
  await restarted.mount(); await restarted.connect(); await restarted.pump();
  assert.equal(restarted.sockets[0].frames.find(frame => frame.event === 'pull' && frame.collection === 'mealLogs').checkpoint, null);
  assert.equal(restarted.stores.meals.mealDocuments.length, 102);
  await restarted.close();
});

test('restart during orphan-cursor recovery cannot resume beyond the durable partial cache', async () => {
  const physical = disk(), history = Array.from({ length: 101 }, (_, i) => meal(i + 1));
  const first = launch(physical, history);
  await first.storage.setItem(cursorKey, JSON.stringify({ ...checkpoint(history.at(-1)), cacheVersion: 1 }));
  physical.controls.beforeWrite = (uri, encoded) => {
    if (uri.startsWith(filePath(cursorKey)) && JSON.parse(encoded).value !== null) throw Error('Synthetic interrupted cursor write');
  };
  await first.mount(); await first.connect();
  await first.pump(() => first.client.getStatusSnapshot().phase === 'error');
  assert.equal(first.stores.meals.mealDocuments.length, 50);
  assert.equal(await first.storage.getItem(cursorKey), null);
  await first.close();
  physical.controls.beforeWrite = undefined;
  const restarted = launch(physical, history);
  await restarted.mount(); await restarted.connect(); await restarted.pump();
  assert.equal(restarted.stores.meals.mealDocuments.length, 101);
  await restarted.close();
});
