import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = require('../src/services/sync/types.ts');
const source = fs.readFileSync(path.join(root, 'src/services/sync/sync-client.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const collections = ['userPreferences', 'mealTemplates', 'mealLogs', 'weightLogs'];
const cacheKey = ns => `@balance_sync_collection_v2:${ns}:mealLogs`;
const cursorKey = ns => `@balance_sync_checkpoint_v2:${ns}:mealLogs`;
const outboxKey = ns => `@balance_sync_outbox_v2:${ns}`;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const meal = n => ({ id: uuid(n), templateId: uuid(999), nameSnapshot: 'Synthetic', nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 1, carbs: 2, fat: 3 } }, canonicalQuantity: 100, entry: { enteredQuantity: 100 }, consumedAt: 1700000000000, updatedAt: 1000, _deleted: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const merge = (before, incoming) => [...new Map([...before, ...incoming].map(doc => [doc.id, doc])).values()];

// Every fixture constructs a new actual SyncClient module. Only platform I/O is
// controlled; `disk` can survive module recreation to model a cold app restart.
function fixture(disk = new Map(), control = {}) {
  const sockets = [];
  let timerId = 0;
  const timers = new Map();
  class Socket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 0; frames = []; answered = new Set();
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); this.receive({ event: 'authenticated' }); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    pending(event, collection) { return this.frames.find(f => f.event === event && (!collection || f.collection === collection) && !this.answered.has(f.requestId)); }
    page(documents = [], more = false, collection = 'mealLogs') {
      const request = this.pending('pull', collection); assert.ok(request, `missing ${collection} request`); this.answered.add(request.requestId);
      const last = documents.at(-1);
      this.receive({ event: 'pull_response', collection, requestId: request.requestId, documents,
        checkpoint: last ? { updatedAt: last.updatedAt, id: String(last.id) } : null, hasMoreDocuments: more });
      return request;
    }
    ack(extra = {}) {
      const request = this.pending('push'); assert.ok(request, 'missing upload request'); this.answered.add(request.requestId);
      this.receive({ event: 'push_response', collection: request.collection, requestId: request.requestId, conflicts: [], rejections: [], ...extra });
    }
  }
  const storage = {
    async getItem(key) { await control.beforeGet?.(key); return disk.get(key) ?? null; },
    async setItem(key, value) { await control.beforeSet?.(key, value); disk.set(key, value); },
    async removeItem(key) { await control.beforeRemove?.(key); disk.delete(key); },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, WebSocket: Socket,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } };
      if (name === '@/services/config') return { WS_SYNC_URL: 'wss://fixture.invalid', WS_AUTH_MODE: 'application' };
      if (name === '@/services/auth/session-state') return { accessTokenChanged: (a, b) => a !== b };
      if (name === '@/services/storage') return { storage };
      if (name === './types') return types;
      throw new Error(`Unexpected dependency ${name}`);
    },
  }, { filename: 'sync-client.ts' });
  const client = module.exports.syncClient;
  async function boot(handlers, namespace = 'user:fixture') {
    for (const collection of collections) client.registerCollection(collection,
      collection === 'mealLogs' ? handlers : { canResume: () => true, onDocuments() {} });
    client.connect('fixture-token', namespace); const socket = sockets.at(-1); socket.open(); await settle();
    for (const collection of collections) if (collection !== 'mealLogs') socket.page([], false, collection);
    await settle(); return socket;
  }
  return { client, sockets, disk, storage, boot };
}

test('the actual client waits for durable application before count, checkpoint and next page', async () => {
  const disk = new Map(), gate = deferred(); const f = fixture(disk);
  const socket = await f.boot({ canResume: () => true, async onDocuments(documents) {
    await gate.promise; disk.set(cacheKey('user:fixture'), JSON.stringify(documents));
  } });
  socket.page([meal(1)], true); await settle();
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0);
  assert.equal(disk.has(cursorKey('user:fixture')), false);
  assert.equal(socket.pending('pull', 'mealLogs'), undefined, 'no next request before the current page is durable');
  gate.resolve(); await settle();
  assert.equal(JSON.parse(disk.get(cacheKey('user:fixture'))).length, 1);
  const cursor = JSON.parse(disk.get(cursorKey('user:fixture')));
  assert.equal(cursor.cacheVersion, 1); assert.equal(cursor.id, uuid(1));
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 1);
  assert.deepEqual(socket.pending('pull', 'mealLogs').checkpoint, { updatedAt: 1000, id: uuid(1) });
  assert.equal('cacheVersion' in socket.pending('pull', 'mealLogs').checkpoint, false);
});

test('failed durable application remains a local failure without advancing an existing cursor', async () => {
  const key = cursorKey('user:fixture');
  const original = JSON.stringify({ updatedAt: 1000, id: uuid(1), cacheVersion: 1 });
  const disk = new Map([[key, original]]), f = fixture(disk);
  const socket = await f.boot({ canResume: () => true, async onDocuments() { throw new Error('synthetic durable write failure'); } });
  socket.page([meal(2)]); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'error'); assert.equal(f.client.getStatusSnapshot().error, 'local');
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0); assert.equal(disk.get(key), original);
});

test('a persisted versioned cursor requires an explicit valid durable-cache proof; legacy cursors always replay', async () => {
  for (const [version, proof] of [[undefined, true], [1, false], [1, undefined]]) {
    const disk = new Map([[cursorKey('user:fixture'), JSON.stringify({ updatedAt: 1000, id: uuid(3), cacheVersion: version })]]);
    const f = fixture(disk);
    const handlers = { onDocuments() {} };
    if (proof !== undefined) handlers.canResume = () => proof;
    const socket = await f.boot(handlers);
    assert.equal(socket.pending('pull', 'mealLogs').checkpoint, null, 'missing/corrupt/legacy-origin cache cannot authorize incremental resume');
  }
  const disk = new Map([[cursorKey('user:fixture'), JSON.stringify({ updatedAt: 1000, id: uuid(3), cacheVersion: 1 })]]);
  const f = fixture(disk); const socket = await f.boot({ canResume: () => true, onDocuments() {} });
  assert.deepEqual(socket.pending('pull', 'mealLogs').checkpoint, { updatedAt: 1000, id: uuid(3) });
});

test('cold recreation replays valid partial legacy cache and interrupted application while retaining pending outbox', async () => {
  const ns = 'user:fixture';
  const queued = { collection: 'mealLogs', document: meal(4), queuedAt: 1 };
  const legacyCursor = JSON.stringify({ updatedAt: 1000, id: uuid(3) });
  const disk = new Map([[cacheKey(ns), JSON.stringify([meal(1)])], [cursorKey(ns), legacyCursor], [outboxKey(ns), JSON.stringify([queued])]]);
  const interrupted = deferred(); let firstCache = JSON.parse(disk.get(cacheKey(ns)));
  const first = fixture(disk); const socket1 = await first.boot({ canResume: () => true, async onDocuments(documents) {
    firstCache = merge(firstCache, documents); disk.set(cacheKey(ns), JSON.stringify(firstCache)); await interrupted.promise;
  } });
  assert.equal(socket1.pending('pull', 'mealLogs').checkpoint, null, 'even syntactically valid partial cache does not validate a legacy cursor');
  socket1.page([meal(1), meal(2)], true); await settle();
  assert.equal(JSON.parse(disk.get(cacheKey(ns))).length, 2); assert.equal(disk.has(cursorKey(ns)), false, 'unsafe legacy frontier is invalidated before partial replay persistence');
  first.client.disconnect();
  // New JS module and cache refs, with only durable physical values carried over.
  let recoveredCache = JSON.parse(disk.get(cacheKey(ns)));
  const recovered = fixture(disk); const socket2 = await recovered.boot({ canResume: () => true, async onDocuments(documents) {
    recoveredCache = merge(recoveredCache, documents); disk.set(cacheKey(ns), JSON.stringify(recoveredCache));
  } });
  assert.equal(socket2.pending('pull', 'mealLogs').checkpoint, null);
  assert.equal(JSON.parse(disk.get(outboxKey(ns)))[0].document.id, uuid(4));
  socket2.page([meal(1), meal(2), meal(3)]); await settle();
  assert.equal(recoveredCache.length, 3); assert.equal(JSON.parse(disk.get(cursorKey(ns))).cacheVersion, 1);
  assert.equal(recovered.client.getStatusSnapshot().pendingChanges, 1, 'restart preserves the original pending upload');
  socket2.ack(); await settle(); assert.equal(recovered.client.getStatusSnapshot().phase, 'synced');
  recovered.client.disconnect();
  let thirdCache = JSON.parse(disk.get(cacheKey(ns)));
  const third = fixture(disk); const socket3 = await third.boot({ canResume: () => true, async onDocuments(documents) {
    thirdCache = merge(thirdCache, documents); disk.set(cacheKey(ns), JSON.stringify(thirdCache));
  } });
  assert.deepEqual(socket3.pending('pull', 'mealLogs').checkpoint, { updatedAt: 1000, id: uuid(3) });
  socket3.page([]); await settle();
  assert.equal(thirdCache.length, 3, 'zero new records after restart retain the complete durable history');
  assert.equal(third.client.getStatusSnapshot().phase, 'synced');
  interrupted.resolve(); await settle();
  assert.equal(JSON.parse(disk.get(cursorKey(ns))).id, uuid(3), 'old application completion cannot overwrite the new checkpoint');
});

test('application completing after logout/account replacement cannot advance the old cursor or current account count', async () => {
  const gate = deferred(), disk = new Map(); const f = fixture(disk);
  const socketA = await f.boot({ canResume: () => true, async onDocuments() { await gate.promise; } }, 'user:A');
  socketA.page([meal(1)]); await settle(); f.client.disconnect();
  const socketB = await f.boot({ canResume: () => true, async onDocuments(documents) { disk.set(cacheKey('user:B'), JSON.stringify(documents)); } }, 'user:B');
  gate.resolve(); await settle();
  assert.equal(disk.has(cursorKey('user:A')), false); assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0);
  socketB.page([meal(2)]); await settle();
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 1); assert.equal(JSON.parse(disk.get(cursorKey('user:B'))).id, uuid(2));
});

test('push conflicts and rejections retain durable outbox until provider persistence resolves', async () => {
  for (const rejection of [false, true]) {
    const gate = deferred(), ns = 'user:fixture';
    const disk = new Map([[outboxKey(ns), JSON.stringify([{ collection: 'mealLogs', document: meal(1), queuedAt: 1 }])]]);
    const f = fixture(disk);
    const handlers = { canResume: () => true, onDocuments() {},
      onPushConflicts: rejection ? undefined : async () => { await gate.promise; },
      onPushRejected: rejection ? async () => { await gate.promise; } : undefined };
    const socket = await f.boot(handlers); socket.page([]); await settle();
    socket.ack(rejection ? { rejections: [{ index: 0, code: 'invalid_document', message: 'synthetic' }] } : { conflicts: [meal(1)] }); await settle();
    assert.equal(JSON.parse(disk.get(outboxKey(ns))).length, 1);
    assert.equal(f.client.getStatusSnapshot().pendingChanges, 1);
    gate.resolve(); await settle();
    assert.equal(JSON.parse(disk.get(outboxKey(ns))).length, 0);
  }
});


test('versioned high cursor is durably invalidated before partial cache replay so interruption cannot skip history', async () => {
  const ns = 'user:fixture', key = cursorKey(ns);
  const disk = new Map([[key, JSON.stringify({ updatedAt: 1000, id: uuid(3), cacheVersion: 1 })]]);
  const first = fixture(disk, { beforeSet(storageKey) { if (storageKey === key) throw new Error('synthetic cursor write interruption'); } });
  const socket1 = await first.boot({ canResume: () => false, async onDocuments(documents) {
    assert.equal(disk.has(key), false, 'old high frontier must be absent BEFORE new partial cache is written');
    disk.set(cacheKey(ns), JSON.stringify(documents));
  } });
  assert.equal(socket1.pending('pull', 'mealLogs').checkpoint, null);
  socket1.page([meal(1)], true); await settle();
  assert.equal(first.client.getStatusSnapshot().phase, 'error'); assert.equal(first.client.getStatusSnapshot().error, 'local');
  assert.equal(disk.has(key), false); assert.equal(JSON.parse(disk.get(cacheKey(ns))).length, 1);
  first.client.disconnect();
  let cache = JSON.parse(disk.get(cacheKey(ns)));
  const second = fixture(disk); const socket2 = await second.boot({ canResume: () => true, async onDocuments(documents) {
    cache = merge(cache, documents); disk.set(cacheKey(ns), JSON.stringify(cache));
  } });
  assert.equal(socket2.pending('pull', 'mealLogs').checkpoint, null, 'fresh launch cannot reuse the old high frontier with its now-valid partial cache');
  socket2.page([meal(1), meal(2), meal(3)]); await settle();
  assert.equal(cache.length, 3); assert.equal(JSON.parse(disk.get(key)).id, uuid(3));
  assert.equal(second.client.getStatusSnapshot().phase, 'synced');
});

test('failed unsafe-cursor invalidation is local and prevents both pull and cache application', async () => {
  const ns = 'user:fixture', key = cursorKey(ns);
  const original = JSON.stringify({ updatedAt: 1000, id: uuid(3), cacheVersion: 1 });
  const disk = new Map([[key, original]]); let applied = 0;
  const f = fixture(disk, { beforeRemove(storageKey) { if (storageKey === key) throw new Error('synthetic remove failure'); } });
  const socket = await f.boot({ canResume: () => false, async onDocuments() { applied++; } });
  assert.equal(socket.pending('pull', 'mealLogs'), undefined); assert.equal(applied, 0);
  assert.equal(disk.get(key), original); assert.equal(disk.has(cacheKey(ns)), false);
  assert.equal(f.client.getStatusSnapshot().phase, 'error'); assert.equal(f.client.getStatusSnapshot().error, 'local');
});

test('provider invalidation before connection affects only the captured namespace cursor and performs no network', async () => {
  const a = 'user:A', b = 'user:B';
  const disk = new Map([[cursorKey(a), 'old-cursor'], [cursorKey(b), 'other-cursor'],
    [cacheKey(a), JSON.stringify([meal(1)])], [outboxKey(a), JSON.stringify([{ collection: 'mealLogs', document: meal(2), queuedAt: 1 }])]]);
  const f = fixture(disk); await f.client.invalidateCollectionCheckpoint('mealLogs', a);
  assert.equal(disk.has(cursorKey(a)), false); assert.equal(disk.get(cursorKey(b)), 'other-cursor');
  assert.equal(JSON.parse(disk.get(cacheKey(a))).length, 1); assert.equal(JSON.parse(disk.get(outboxKey(a))).length, 1);
  assert.equal(f.sockets.length, 0); assert.equal(f.client.getStatusSnapshot().phase, 'inactive');
});
