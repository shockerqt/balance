const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), local = createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const { prepareSelectionCopy } = local('./src/components/meal/native/copy-selection-contract.ts');
const { authDataNamespace } = local('./src/services/auth/session-state.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const api = 'https://fixture.invalid/api';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const fixedNow = 1793361600000;
const meal = (n, updatedAt = fixedNow - 1000) => ({ id: uuid(n), templateId: null, nameSnapshot: 'Synthetic canonical history',
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 0, fiber: null } },
  canonicalQuantity: 50, entry: { enteredQuantity: 50 }, consumedAt: 1793325600000 + n, updatedAt, _deleted: false });
const file = key => `file:///documents/balance-sync-v1/${crypto.createHash('sha256').update(key).digest('hex')}.json`;
const contents = (disk, uri) => {
  const envelope = JSON.parse(disk.files.get(uri) ?? 'null');
  return envelope?.value == null ? [] : JSON.parse(envelope.value);
};

function physicalDisk() {
  const files = new Map(), legacy = new Map(), controls = {}, moves = [];
  return { files, controls, moves,
    native: { getItem: async key => legacy.get(key) ?? null, setItem: async (key, value) => legacy.set(key, value), removeItem: async key => legacy.delete(key) },
    fileSystem: { documentDirectory: 'file:///documents/', EncodingType: { UTF8: 'utf8' },
      getInfoAsync: async uri => ({ exists: files.has(uri) }), makeDirectoryAsync: async () => {},
      async readAsStringAsync(uri) { await controls.beforeRead?.(uri); if (!files.has(uri)) throw Error('missing'); return files.get(uri); },
      async writeAsStringAsync(uri, value) { files.set(uri, value); },
      async moveAsync({ from, to }) { await controls.beforeMove?.(from, to); moves.push(to); files.set(to, files.get(from)); files.delete(from); },
      async deleteAsync(uri) { files.delete(uri); },
    },
  };
}

async function fixture({ physical = physicalDisk(), documents = [], userId = 1, seed = true } = {}) {
  let user = { id: userId }, store, view, namespace = authDataNamespace(api, userId), timer = 0;
  const modules = new Map(), timers = new Map(), sockets = [];
  class FixedDate extends Date { static now() { return fixedNow; } }
  class Socket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 0; frames = []; answered = new Set();
    constructor() { sockets.push(this); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    pending(event) { return this.frames.find(frame => frame.event === event && !this.answered.has(frame.requestId)); }
    ack(extra = {}) { const frame = this.pending('push'); assert.ok(frame); this.answered.add(frame.requestId);
      this.receive({ event: 'push_response', requestId: frame.requestId, collection: frame.collection, conflicts: [], rejections: [], ...extra }); return frame; }
  }
  const globals = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@react-native-async-storage/async-storage': { default: physical.native, ...physical.native }, 'expo-file-system/legacy': physical.fileSystem,
    'expo-crypto': { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_, value) => crypto.createHash('sha256').update(value).digest('hex') },
    '@/services/config': { API_BASE_URL: api, WS_SYNC_URL: 'wss://fixture.invalid/sync', WS_AUTH_MODE: 'application' },
    '@/hooks/use-auth': { useAuth: () => ({ user, isGuest: false }) }, '@/services/import/guest-import': { recoverGuestImport: async () => null },
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
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { fileName: full, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, Date: FixedDate, WebSocket: Socket, console, __DEV__: false,
      setTimeout(fn, delay = 0) { const id = ++timer; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
      setInterval: () => 1, clearInterval() {}, URL, TextEncoder, TextDecoder }, { filename: full });
    return module.exports;
  }
  const storage = load(path.join(root, 'src/services/storage.ts')).storage;
  const owner = load(path.join(root, 'src/services/sync/sync-client.ts'));
  const client = owner.syncClient;
  const meals = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const cacheKey = ns => owner.collectionStorageKey(ns, 'mealLogs'), outboxKey = ns => `@balance_sync_outbox_v2:${ns}`;
  if (seed) await storage.setItem(cacheKey(namespace), JSON.stringify(documents));
  client.setNamespace(namespace);
  function Probe() { store = meals.useMealStore(); return null; }
  const tree = () => React.createElement(meals.MealStoreProvider, null, React.createElement(Probe));
  await renderer.act(async () => { view = renderer.create(tree()); await tick(); });
  async function settle(turns = 4) {
    for (let i = 0; i < turns; i++) await renderer.act(async () => {
      for (const [id, task] of [...timers]) if (task.delay === 0 && timers.delete(id)) task.fn();
      await tick();
    });
  }
  return { client, storage, physical, owner, settle, get store() { return store; }, get namespace() { return namespace; },
    cacheKey, outboxKey, queued: () => contents(physical, file(outboxKey(namespace))),
    async connect() { await renderer.act(async () => {
      client.connect('synthetic-token', namespace); const socket = sockets.at(-1); socket.readyState = 1; socket.onopen?.(); socket.receive({ event: 'authenticated' }); await tick();
    }); await settle(); return sockets.at(-1); },
    async account(id) { user = { id }; namespace = authDataNamespace(api, id); client.setNamespace(namespace); await renderer.act(async () => { view.update(tree()); await tick(); }); await settle(); },
    async close() { client.disconnect(); await renderer.act(async () => { view.unmount(); await tick(); }); },
  };
}

test('actual store commits the complete selection in one durable outbox write and recovers after cold restart', async () => {
  const physical = physicalDisk(), f = await fixture({ physical, documents: [meal(1)] });
  const copies = [meal(10, fixedNow), meal(11, fixedNow)].map(doc => ({ ...doc, copySource: { id: uuid(1), updatedAt: fixedNow - 1000 } }));
  try {
    const outboxFile = file(f.outboxKey(f.namespace)), before = physical.moves.filter(p => p === outboxFile).length;
    await renderer.act(async () => { await f.store.registerMealLogs(copies); });
    assert.equal(physical.moves.filter(p => p === outboxFile).length - before, 1);
    assert.deepEqual(f.queued().map(row => row.document.id), copies.map(doc => doc.id));
    await f.settle();
    assert.deepEqual(new Set(f.store.mealDocuments.map(doc => doc.id)), new Set([uuid(1), uuid(10), uuid(11)]));
  } finally { await f.close(); }
  const restarted = await fixture({ physical, seed: false });
  try { await restarted.settle(); assert.equal(restarted.queued().length, 2); assert.equal(restarted.store.mealDocuments.length, 3); }
  finally { await restarted.close(); }
});

test('failed atomic batch keeps old outbox intact and retries the same IDs without a partial receipt', async () => {
  const f = await fixture({ documents: [meal(1)] });
  const copies = [meal(10, fixedNow), meal(11, fixedNow)];
  const outboxFile = file(f.outboxKey(f.namespace));
  let fail = true;
  f.physical.controls.beforeMove = (_, to) => { if (to === outboxFile && fail) throw Error('synthetic disk failure'); };
  try {
    await assert.rejects(() => f.store.registerMealLogs(copies));
    await f.settle();
    assert.equal(f.queued().length, 0); assert.equal(f.store.mealDocuments.length, 1);
    fail = false;
    await renderer.act(async () => { await f.store.registerMealLogs(copies); }); await f.settle();
    assert.equal(f.queued().length, 2); assert.equal(f.store.mealDocuments.length, 3);
    assert.deepEqual(f.queued().map(row => row.document.id), copies.map(doc => doc.id));
  } finally { await f.close(); }
});

test('topological wire order preserves indexed rejections and independent accepted records', async () => {
  const source = meal(1), first = { ...meal(10), copySource: { id: source.id, updatedAt: source.updatedAt } },
    second = { ...meal(11), copySource: { id: first.id, updatedAt: first.updatedAt } }, independent = meal(20);
  const f = await fixture();
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([second, independent, first, source]); }); await f.settle();
    const socket = await f.connect(), frame = socket.pending('push'), ids = frame.rows.map(row => row.newDocumentState.id);
    assert.ok(ids.indexOf(source.id) < ids.indexOf(first.id)); assert.ok(ids.indexOf(first.id) < ids.indexOf(second.id));
    socket.ack({ rejections: [first, second].map(doc => ({ index: ids.indexOf(doc.id), code: 'copy_source_unavailable', message: 'synthetic unavailable source' })) });
    await f.settle(8);
    assert.equal(f.queued().length, 0);
    assert.deepEqual(new Set(f.store.mealDocuments.map(doc => doc.id)), new Set([source.id, independent.id]));
    assert.equal(f.client.getStatusSnapshot().error, 'upload');
  } finally { await f.close(); }
});

test('same-clock edits/tombstone before first push advance revisions and preserve the creation intention', async () => {
  const source = meal(1), copied = { ...meal(10, fixedNow), copySource: { id: source.id, updatedAt: source.updatedAt } };
  const physical = physicalDisk(), f = await fixture({ physical, documents: [source] });
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([copied]); }); await f.settle();
    await renderer.act(async () => { f.store.updateFood('2026-10-30', copied.id, { portion: '60g', time: '15:20' }); await tick(); }); await f.settle();
    const edited = f.store.mealDocuments.find(doc => doc.id === copied.id);
    assert.equal(edited.updatedAt, fixedNow + 1); assert.equal(edited.canonicalQuantity, 60);
    await renderer.act(async () => { f.store.deleteMultipleFoods('2026-10-30', [copied.id]); await tick(); }); await f.settle();
    const deleted = f.store.mealDocuments.find(doc => doc.id === copied.id);
    assert.equal(deleted.updatedAt, fixedNow + 2); assert.equal(deleted._deleted, true);
    assert.deepEqual(JSON.parse(JSON.stringify(deleted.copySource)), copied.copySource);
    const socket = await f.connect(), sent = socket.pending('push').rows[0].newDocumentState;
    assert.equal(sent.updatedAt, fixedNow + 2); assert.equal(sent._deleted, true); assert.deepEqual(sent.copySource, copied.copySource);
    socket.ack(); await f.settle(); assert.equal(f.queued().length, 0);
  } finally { await f.close(); }
  const restart = await fixture({ physical, seed: false });
  try {
    await restart.settle();
    assert.equal(restart.store.mealDocuments.find(doc => doc.id === copied.id)?._deleted, true);
    assert.equal(Object.values(restart.store.dayLogs).some(day => day.foods.some(food => food.id === copied.id)), false);
    assert.equal(restart.store.mealDocuments.find(doc => doc.id === source.id)?._deleted, false);
  }
  finally { await restart.close(); }
});

test('an ACK for an older sent copy cannot drain its newer edit or erase copySource', async () => {
  const source = meal(1), copied = { ...meal(10, fixedNow), copySource: { id: source.id, updatedAt: source.updatedAt } };
  const f = await fixture({ documents: [source] });
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([copied]); }); await f.settle();
    const socket = await f.connect(), old = socket.pending('push');
    await renderer.act(async () => { f.store.updateFood('2026-10-30', copied.id, { portion: '75g' }); await tick(); }); await f.settle();
    socket.ack({ conflicts: [{ ...copied, copySource: undefined }] }); await f.settle(8);
    assert.equal(f.queued().length, 1); assert.equal(f.queued()[0].document.updatedAt, fixedNow + 1);
    const next = socket.pending('push'); assert.notEqual(next.requestId, old.requestId);
    assert.equal(next.rows[0].newDocumentState.canonicalQuantity, 75); assert.deepEqual(next.rows[0].newDocumentState.copySource, copied.copySource);
    socket.ack(); await f.settle(); assert.equal(f.queued().length, 0);
  } finally { await f.close(); }
});

test('an older rejection cannot remove a newer pending copy revision from the visible cache', async () => {
  const source = meal(1), copied = { ...meal(10, fixedNow), copySource: { id: source.id, updatedAt: source.updatedAt } };
  const f = await fixture({ documents: [source] });
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([copied]); }); await f.settle();
    const socket = await f.connect();
    await renderer.act(async () => { f.store.updateFood('2026-10-30', copied.id, { portion: '75g' }); await tick(); }); await f.settle();
    socket.ack({ rejections: [{ index: 0, code: 'copy_source_unavailable', message: 'synthetic source changed' }] });
    await f.settle(8);
    assert.equal(f.queued().length, 1);
    const current = f.store.mealDocuments.find(doc => doc.id === copied.id);
    assert.equal(current?.updatedAt, fixedNow + 1);
    assert.equal(current?.canonicalQuantity, 75);
    socket.ack(); await f.settle();
  } finally { await f.close(); }
});

test('cyclic dependency is rejected through the existing owner while unrelated work can upload', async () => {
  const a = { ...meal(10), copySource: { id: uuid(11), updatedAt: fixedNow - 1000 } }, b = { ...meal(11), copySource: { id: uuid(10), updatedAt: fixedNow - 1000 } };
  const f = await fixture();
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([a, b, meal(20)]); }); await f.settle();
    const socket = await f.connect(), ids = socket.pending('push').rows.map(row => row.newDocumentState.id);
    assert.deepEqual(ids, [uuid(20)]); socket.ack(); await f.settle(8);
    assert.equal(f.queued().length, 0); assert.deepEqual(Array.from(f.store.mealDocuments, doc => doc.id), [uuid(20)]);
  } finally { await f.close(); }
});

test('a durable batch crossing account replacement remains confined to its original namespace', async () => {
  const f = await fixture(), originalNamespace = f.namespace, gate = deferred();
  const outboxFile = file(f.outboxKey(originalNamespace));
  f.physical.controls.beforeMove = (_, to) => to === outboxFile ? gate.promise : undefined;
  let pending;
  try {
    await renderer.act(async () => { pending = f.store.registerMealLogs([meal(10), meal(11)]); await tick(); });
    await f.account(2); gate.resolve(); await renderer.act(async () => { await pending; }); await f.settle();
    assert.equal(f.store.mealDocuments.length, 0); assert.equal(f.queued().length, 0);
    assert.equal(contents(f.physical, outboxFile).length, 2);
    await f.account(1); assert.equal(f.store.mealDocuments.length, 2);
  } finally { gate.resolve(); await f.close(); }
});

test('ACK retirement cannot overwrite a newer batch that is committing at the same time', async () => {
  const physical = physicalDisk(), f = await fixture({ physical, documents: [meal(1)] }), gate = deferred();
  const fresh = meal(20, fixedNow), old = meal(10, fixedNow), outboxFile = file(f.outboxKey(f.namespace));
  let pending, blocked = false;
  try {
    await renderer.act(async () => { await f.store.registerMealLogs([old]); }); await f.settle();
    const socket = await f.connect();
    physical.controls.beforeMove = (from, to) => {
      if (to === outboxFile && contents(physical, from).some(row => row.document.id === fresh.id)) { blocked = true; return gate.promise; }
    };
    await renderer.act(async () => { pending = f.store.registerMealLogs([fresh]); await tick(); });
    assert.equal(blocked, true);
    socket.ack();
    await renderer.act(async () => { await tick(); await tick(); });
    gate.resolve();
    // Observe durable bytes after both IO operations, before deferred UI/flush
    // timers have any chance to rescue a RAM-only new record.
    await renderer.act(async () => { await pending; await tick(); await tick(); });
    assert.ok(f.queued().some(row => row.document.id === fresh.id), 'a successful new receipt remains in the durable queue');
  } finally { gate.resolve(); await f.close(); }
  const restart = await fixture({ physical, seed: false });
  try { await restart.settle(); assert.ok(restart.store.mealDocuments.some(doc => doc.id === fresh.id)); }
  finally { await restart.close(); }
});

test('a large-history copy batch commits one outbox and one complete cache overlay after its receipt', async () => {
  const history = Array.from({ length: 12000 }, (_, i) => meal(i + 1));
  const f = await fixture({ documents: history });
  try {
    const copies = Array.from({ length: 12 }, (_, i) => ({ ...meal(13000 + i, fixedNow), copySource: { id: uuid(i + 1), updatedAt: fixedNow - 1000 } }));
    const outboxFile = file(f.outboxKey(f.namespace)), cacheFile = file(f.cacheKey(f.namespace));
    f.physical.moves.length = 0;
    await renderer.act(async () => { await f.store.registerMealLogs(copies); });
    assert.equal(f.physical.moves.filter(p => p === outboxFile).length, 1);
    assert.equal(f.store.mealDocuments.length, history.length, 'receipt precedes full-history overlay work');
    await f.settle(8);
    assert.equal(f.store.mealDocuments.length, history.length + copies.length);
    assert.equal(f.physical.moves.filter(p => p === cacheFile).length, 1);
    const stored = contents(f.physical, cacheFile);
    assert.equal(stored.length, 12012); assert.deepEqual(stored.slice(0, history.length), history);
  } finally { await f.close(); }
});
