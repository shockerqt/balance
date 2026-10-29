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
const checkpointKey = (ns, collection) => `@balance_sync_checkpoint_v2:${ns}:${collection}`;
const outboxKey = ns => `@balance_sync_outbox_v2:${ns}`;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const meal = n => ({ id: uuid(n), templateId: uuid(999), nameSnapshot: 'Synthetic', nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 1, carbs: 2, fat: 3 } }, canonicalQuantity: 100, entry: { enteredQuantity: 100 }, consumedAt: 1700000000000, updatedAt: 1000, _deleted: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ data = new Map(), controls = {} } = {}) {
  const sockets = [], timers = new Map(), applied = new Map(), rejected = [], snapshots = [];
  let timerId = 0;
  class Socket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 0; frames = []; answered = new Set();
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    ack() { this.receive({ event: 'authenticated' }); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    pending(event, collection) { return this.frames.find(f => f.event === event && (!collection || f.collection === collection) && !this.answered.has(f.requestId)); }
    answer(collection, documents = [], hasMoreDocuments = false, extra = {}) {
      const request = this.pending('pull', collection); assert.ok(request, `no pending ${collection} pull`);
      this.answered.add(request.requestId);
      const last = documents.at(-1);
      this.receive({ event: 'pull_response', requestId: request.requestId, collection, documents,
        checkpoint: last ? { updatedAt: last.updatedAt, id: String(last.id) } : null, hasMoreDocuments, ...extra });
      return request;
    }
    pushAck(extra = {}) {
      const request = this.pending('push'); assert.ok(request, 'no pending push'); this.answered.add(request.requestId);
      this.receive({ event: 'push_response', requestId: request.requestId, collection: request.collection, conflicts: [], rejections: [], ...extra });
      return request;
    }
  }
  const storage = {
    async getItem(key) { await controls.beforeGet?.(key); return data.get(key) ?? null; },
    async setItem(key, value) { await controls.beforeSet?.(key, value); data.set(key, value); },
    async removeItem(key) { await controls.beforeRemove?.(key); data.delete(key); },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, WebSocket: Socket,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
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
  client.subscribeStatus(() => snapshots.push(client.getStatusSnapshot()));
  function register(collection, ready) {
    applied.set(collection, []);
    return client.registerCollection(collection, {
      onDocuments(documents) { applied.get(collection).push(...documents); },
      onPushRejected(rows) { rejected.push(...rows); },
    }, ready);
  }
  async function boot({ omit = [], weights = true, namespace = 'user:fixture' } = {}) {
    if (!weights) client.setCollectionEnabled('weightLogs', false);
    for (const c of collections) if (!omit.includes(c) && (weights || c !== 'weightLogs')) register(c);
    client.connect('fixture-token', namespace);
    const socket = sockets.at(-1); socket.open(); socket.ack(); await settle(); return socket;
  }
  function fire(delay) {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
  }
  async function finishOther(socket, except = []) {
    for (const c of collections) if (!except.includes(c) && socket.pending('pull', c)) socket.answer(c);
    await settle();
  }
  return { client, sockets, data, controls, applied, rejected, snapshots, register, boot, fire, finishOther };
}

test('actual owner publishes stable immutable status through 50/50/1 pages and completes only after all work', async () => {
  const f = fixture(); const socket = await f.boot(); await f.finishOther(socket, ['mealLogs']);
  assert.equal(f.client.getStatusSnapshot().phase, 'syncing');
  assert.equal(socket.pending('pull', 'mealLogs').limit, 50);
  socket.answer('mealLogs', Array.from({ length: 50 }, (_, i) => meal(i + 1)), true); await settle();
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 50);
  assert.equal(f.client.getStatusSnapshot().phase, 'syncing');
  assert.equal(socket.pending('pull', 'mealLogs').checkpoint.id, uuid(50));
  socket.answer('mealLogs', Array.from({ length: 50 }, (_, i) => meal(i + 51)), true); await settle();
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 100);
  assert.ok(f.snapshots.every(s => s.phase !== 'synced'));
  socket.answer('mealLogs', [meal(101)]); await settle();
  const status = f.client.getStatusSnapshot();
  assert.equal(status.phase, 'synced'); assert.equal(status.receivedDocuments, 101); assert.equal(status.pendingChanges, 0);
  assert.equal(typeof status.lastSyncedAt, 'number'); assert.equal(Object.isFrozen(status), true);
  assert.equal(f.client.getStatusSnapshot(), status);
  assert.equal(JSON.stringify(status).includes('fixture'), false, 'public status contains no namespace/token');
  let calls = 0; const off = f.client.subscribeStatus(() => calls++); off();
  void f.client.resyncCollection('mealLogs'); await settle(); assert.equal(calls, 0);
});

test('late registration/readiness blocks completion, and disabled weights are excluded until enabled', async () => {
  const f = fixture(); const socket = await f.boot({ omit: ['weightLogs'] }); await f.finishOther(socket);
  assert.equal(f.client.getStatusSnapshot().phase, 'pending');
  const ready = deferred(); f.register('weightLogs', ready.promise); await settle();
  assert.equal(socket.pending('pull', 'weightLogs'), undefined);
  ready.resolve(); await settle(); socket.answer('weightLogs'); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  const g = fixture(); const second = await g.boot({ weights: false }); await g.finishOther(second);
  assert.equal(g.client.getStatusSnapshot().phase, 'synced');
  g.client.setCollectionEnabled('weightLogs', true); await settle();
  assert.equal(g.client.getStatusSnapshot().phase, 'pending');
  g.register('weightLogs'); await settle(); second.answer('weightLogs'); await settle();
  assert.equal(g.client.getStatusSnapshot().phase, 'synced');
});

test('malformed pages and nonadvancing cursors fail closed without checkpoint advancement; legacy alias remains valid', async () => {
  const cases = [
    { documents: [{ invalid: true }], checkpoint: { updatedAt: 1000, id: uuid(3) } },
    { documents: [], hasMoreDocuments: true, checkpoint: null },
    { documents: [meal(3)], hasMoreDocuments: 'false' },
    { documents: [meal(3)], checkpoint: { updatedAt: 1000, id: uuid(4) } },
    { documents: [meal(1)] },
  ];
  for (const extra of cases) {
    const initial = JSON.stringify({ updatedAt: 1000, id: uuid(2) });
    const key = checkpointKey('user:fixture', 'mealLogs');
    const f = fixture({ data: new Map([[key, initial]]) }); const socket = await f.boot(); await f.finishOther(socket, ['mealLogs']);
    socket.answer('mealLogs', [meal(3)], false, extra); await settle();
    assert.equal(f.client.getStatusSnapshot().phase, 'error'); assert.equal(f.client.getStatusSnapshot().error, 'download');
    assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0); assert.equal(f.data.get(key), initial);
  }
  const f = fixture(); const socket = await f.boot(); await f.finishOther(socket, ['mealLogs']);
  socket.answer('mealLogs', [], false, { hasMoreDocuments: undefined, has_more_documents: false }); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
});

test('timeout after a page and failed checkpoint I/O remain incomplete with sanitized errors', async () => {
  const f = fixture(); const socket = await f.boot(); await f.finishOther(socket, ['mealLogs']);
  socket.answer('mealLogs', [meal(1)], true); await settle(); f.fire(12000); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'error'); assert.equal(f.client.getStatusSnapshot().error, 'download');
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 1);
  const g = fixture({ controls: { beforeSet(key) { if (key.includes('checkpoint') && key.endsWith('mealLogs')) throw new Error('private storage detail'); } } });
  const second = await g.boot(); await g.finishOther(second, ['mealLogs']); second.answer('mealLogs', [meal(1)]); await settle();
  assert.equal(g.client.getStatusSnapshot().phase, 'error'); assert.equal(g.client.getStatusSnapshot().error, 'local');
  assert.equal(g.data.has(checkpointKey('user:fixture', 'mealLogs')), false);
  assert.equal(JSON.stringify(g.client.getStatusSnapshot()).includes('private'), false);
});

test('invalidation during the final checkpoint is followed by another owner pass before success', async () => {
  const gate = deferred(); let blocked = false;
  const f = fixture({ controls: { beforeSet(key) { if (key === checkpointKey('user:fixture', 'mealLogs') && !blocked) { blocked = true; return gate.promise; } } } });
  const socket = await f.boot(); await f.finishOther(socket, ['mealLogs']); socket.answer('mealLogs', [meal(1)]); await settle();
  assert.equal(blocked, true); assert.equal(f.client.getStatusSnapshot().receivedDocuments, 1);
  socket.receive({ event: 'collection_changed', collection: 'mealLogs' }); await settle();
  assert.equal(socket.pending('pull', 'mealLogs'), undefined, 'no parallel request during current pass');
  gate.resolve(); await settle();
  assert.ok(socket.pending('pull', 'mealLogs'), 'known invalidation triggers another pass');
  assert.ok(f.snapshots.every(s => s.phase !== 'synced'));
  socket.answer('mealLogs'); await settle(); assert.equal(f.client.getStatusSnapshot().phase, 'synced');
});

test('hydrated outbox, delayed enqueue, and server acknowledgement each gate success', async () => {
  const hydration = deferred();
  const queued = { collection: 'mealLogs', document: meal(1), previousDocument: null, queuedAt: 1 };
  const f = fixture({ data: new Map([[outboxKey('user:fixture'), JSON.stringify([queued])]]), controls: { beforeGet(key) { if (key === outboxKey('user:fixture')) return hydration.promise; } } });
  const socket = await f.boot(); await f.finishOther(socket);
  assert.notEqual(f.client.getStatusSnapshot().phase, 'synced');
  hydration.resolve(); await settle(); assert.ok(socket.pending('push')); assert.equal(f.client.getStatusSnapshot().pendingChanges, 1);
  socket.pushAck(); await settle(); assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  const enqueueGate = deferred(); f.controls.beforeSet = key => key === outboxKey('user:fixture') ? enqueueGate.promise : undefined;
  const enqueue = f.client.enqueue('mealLogs', meal(2)); await settle();
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 1); assert.equal(f.client.getStatusSnapshot().phase, 'syncing');
  assert.equal(socket.pending('push'), undefined);
  enqueueGate.resolve(); await enqueue; await settle(); assert.ok(socket.pending('push'));
  assert.notEqual(f.client.getStatusSnapshot().phase, 'synced'); socket.pushAck(); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced'); assert.equal(f.client.getStatusSnapshot().pendingChanges, 0);
});

test('changes during a flush use the owner follow-up flush; rejected writes stay error until explicit retry completes', async () => {
  const f = fixture(); const socket = await f.boot(); await f.finishOther(socket);
  await f.client.enqueue('mealLogs', meal(1)); await settle();
  const first = socket.pending('push'); assert.ok(first);
  await f.client.enqueue('mealLogs', meal(2)); await settle();
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 2);
  socket.pushAck(); await settle();
  const second = socket.pending('push'); assert.ok(second); assert.notEqual(first.requestId, second.requestId);
  assert.equal(second.rows.length, 1); assert.equal(second.rows[0].newDocumentState.id, uuid(2));
  socket.pushAck({ rejections: [{ index: 0, code: 'invalid_document', message: 'synthetic rejection' }] }); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'error'); assert.equal(f.client.getStatusSnapshot().error, 'upload');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 0);
  void f.client.resetCollection('mealLogs'); await settle(); socket.answer('mealLogs'); await settle();
  assert.equal(f.client.getStatusSnapshot().error, 'upload', 'another completed download does not hide rejected upload');
  const retry = f.client.retrySync(); await settle(); assert.notEqual(f.client.getStatusSnapshot().phase, 'synced');
  await f.finishOther(socket); await retry; await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
});

test('same-account token rotation preserves readiness and old socket callbacks cannot complete or leak status after logout', async () => {
  const ready = deferred(); const f = fixture();
  for (const c of collections) f.register(c, c === 'mealLogs' ? ready.promise : undefined);
  f.client.connect('fixture-old', 'user:first'); let socket = f.sockets.at(-1); socket.open(); socket.ack(); await settle();
  const stale = socket.pending('pull', 'userPreferences');
  f.client.connect('fixture-new', 'user:first'); f.fire(0); await settle();
  const current = f.sockets.at(-1); assert.notEqual(current, socket); current.open(); current.ack(); await settle();
  assert.equal(current.pending('pull', 'mealLogs'), undefined);
  socket.receive({ event: 'pull_response', requestId: stale.requestId, collection: 'userPreferences', documents: [], checkpoint: null, hasMoreDocuments: false });
  ready.resolve(); await settle(); assert.ok(current.pending('pull', 'mealLogs'));
  await f.finishOther(current, ['mealLogs']); current.answer('mealLogs', [meal(1)]); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced'); assert.equal(f.client.getStatusSnapshot().receivedDocuments, 1);
  f.client.disconnect(); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'inactive'); assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0);
  assert.equal(f.client.getStatusSnapshot().lastSyncedAt, null);
  current.receive({ event: 'collection_changed', collection: 'mealLogs' }); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'inactive');
  f.client.connect('fixture-third', 'user:second'); socket = f.sockets.at(-1); socket.open(); socket.ack(); await settle();
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0); assert.notEqual(f.client.getStatusSnapshot().phase, 'synced');
});


test('failed acknowledged-outbox persistence cannot turn retry green until durable queue recovery', async () => {
  const f = fixture(); const socket = await f.boot(); await f.finishOther(socket);
  const key = outboxKey('user:fixture');
  f.controls.beforeSet = (storageKey, value) => {
    if (storageKey === key && JSON.parse(value).length === 0) throw new Error('synthetic disk failure');
  };
  await f.client.enqueue('mealLogs', meal(1)); await settle();
  socket.pushAck(); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'error');
  assert.equal(f.client.getStatusSnapshot().error, 'local');
  assert.equal(JSON.parse(f.data.get(key)).length, 1, 'disk still contains acknowledged pending entry');
  const failedRetry = f.client.retrySync(); await settle();
  await f.finishOther(socket);
  assert.ok(socket.pending('push'), 'retry rehydrates disk and uses the existing push owner');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 1);
  socket.pushAck(); await failedRetry; await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'error');
  assert.equal(f.client.getStatusSnapshot().error, 'local');
  assert.equal(JSON.parse(f.data.get(key)).length, 1);
  f.controls.beforeSet = undefined;
  const recoveredRetry = f.client.retrySync(); await settle();
  await f.finishOther(socket); socket.pushAck(); await recoveredRetry; await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 0);
  assert.equal(JSON.parse(f.data.get(key)).length, 0, 'durable outbox is drained after recovery');
});


test('an enqueue spanning A to B to A remains pending until its late disk write and current-owner ACK drain', async () => {
  const f = fixture(); let socket = await f.boot({ namespace: 'user:A' }); await f.finishOther(socket);
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  const diskWrite = deferred(); let blocked = false;
  const keyA = outboxKey('user:A');
  f.controls.beforeSet = (key, value) => {
    if (key === keyA && JSON.parse(value).length && !blocked) { blocked = true; return diskWrite.promise; }
  };
  const enqueue = f.client.enqueue('mealLogs', meal(1)); await settle();
  assert.equal(blocked, true); assert.equal(f.client.getStatusSnapshot().pendingChanges, 1);
  f.client.connect('fixture-B', 'user:B'); socket = f.sockets.at(-1); socket.open(); socket.ack(); await settle();
  await f.finishOther(socket);
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 0, 'other-account work never leaks into B status');
  assert.equal(f.client.getStatusSnapshot().receivedDocuments, 0);
  const returnedAt = f.snapshots.length;
  f.client.connect('fixture-return-A', 'user:A'); socket = f.sockets.at(-1); socket.open(); socket.ack(); await settle();
  await f.finishOther(socket);
  assert.notEqual(f.client.getStatusSnapshot().phase, 'synced', 'the original A enqueue is still active despite its older generation');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 1);
  diskWrite.resolve(); await enqueue; await settle();
  assert.ok(socket.pending('push'), 'late write is rehydrated and flushed by current A owner');
  assert.equal(socket.pending('push').rows[0].newDocumentState.id, uuid(1));
  assert.ok(f.snapshots.slice(returnedAt).every(s => s.phase !== 'synced'));
  socket.pushAck(); await settle();
  assert.equal(f.client.getStatusSnapshot().phase, 'synced');
  assert.equal(f.client.getStatusSnapshot().pendingChanges, 0);
  assert.equal(JSON.parse(f.data.get(keyA)).length, 0);
  assert.equal(f.data.has(outboxKey('user:B')), false, 'A write does not mutate B queue');
});
