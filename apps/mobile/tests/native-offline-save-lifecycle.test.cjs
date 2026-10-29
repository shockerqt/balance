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
      await controls.beforeRead?.(key);
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
    async readAsStringAsync(uri) { await controls.beforeRead?.(uri); if (!files.has(uri)) throw Error('Missing file'); return files.get(uri); },
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
  const timers = new Map();
  let timerId = 0;
  // Advance zero-delay macrotasks explicitly, after observing the native receipt.
  // Network timeouts/reconnect timers stay pending until disconnect cancels them.
  const schedule = (callback, delay = 0, ...args) => {
    const id = ++timerId;
    timers.set(id, { callback, delay, args });
    return id;
  };
  const runTimers = () => {
    for (const [id, task] of [...timers]) {
      if (task.delay > 0 || !timers.delete(id)) continue;
      task.callback(...task.args);
    }
  };
  let user = { id: 1 }, focused = true, view, stores = {}, backs = 0;
  class Socket {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    readyState = 0; frames = []; answered = new Set();
    constructor() { sockets.push(this); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const native = { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } };
  const router = {back(){ backs++; }}; const navigation={dispatch(){backs++;}};
  const globals = {
    'expo-router': { useRouter:()=>router, useNavigation:()=>navigation, useLocalSearchParams:()=>({dateId:'2026-10-29',time:'12:30'}), useFocusEffect(cb) { React.useEffect(() => focused ? cb() : undefined, [cb, focused]); } },
    'expo-router/react-navigation': {usePreventRemove(){}},
    '../../../../modules/balance-daily-log/src/BalanceFoodEntryView': {BalanceFoodEntryView:props=>React.createElement('native-entry',props)},
    '@/components/ui': { Screen:props=>React.createElement(React.Fragment,null,props.children) },
    '@/theme': { useTheme:()=>({colors:{background:'#000000'},scheme:'dark',gradients:{}}) },
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
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, WebSocket: Socket, console, __DEV__: false,
      setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {}, setImmediate, URL, TextEncoder, TextDecoder }, { filename: full });
    return module.exports;
  }
  const storage = load(path.join(root, 'src/services/storage.ts')).storage;
  const owner = load(path.join(root, 'src/services/sync/sync-client.ts'));
  const client = owner.syncClient;
  const preferences = load(path.join(root, 'src/hooks/use-preferences-store.tsx'));
  const weights = load(path.join(root, 'src/hooks/use-weight-store.tsx'));
  const meals = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const library = load(path.join(root, 'src/hooks/use-food-library-store.tsx'));
  const entry = load(path.join(root,'src/components/meal/native/native-food-entry-screen.tsx')).default;
  function Probe() {
    stores = { meals: meals.useMealStore(), weights: weights.useWeightStore(), preferences: preferences.usePreferencesStore(), library: library.useFoodLibraryStore() };
    return React.createElement(entry);
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
        runTimers();
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
    timers.clear();
  }
  async function runDeferred() {
    await renderer.act(async () => { runTimers(); await tick(); });
  }
  async function setFocus(next) {
    focused = next;
    await renderer.act(async () => { view.update(tree()); await tick(); });
  }
  async function setUser(id) {
    user = { id };
    client.setNamespace(identity.authDataNamespace(api, id));
    await renderer.act(async () => { view.update(tree()); await tick(); });
  }
  const props = () => view.root.findByType('native-entry').props;
  const data = () => JSON.parse(props().data);
  const status = () => JSON.parse(props().status);
  const event = (sequence = 1, overrides = {}) => ({ nativeEvent: {
    session: data().session, sequence, action: 'save', input: JSON.stringify(input), ...overrides,
  } });
  return {
    storage, client, owner, server, sockets, mount, connect, pump, close, runDeferred, setFocus, setUser,
    props, data, status, event, save: sequence => props().onAction(event(sequence)),
    get stores() { return stores; }, get backs() { return backs; },
  };
}

const input = {
  date: '2026-10-29', time: '12:30', name: 'Offline synthetic', unit: 'g', quantity: '100',
  nutrients: { calories: '100', protein: '2', carbs: '20', fat: '1' },
};
const act = callback => renderer.act(async () => { await callback(); await tick(); });
const queued = async (app, key = outboxKey) => JSON.parse(await app.storage.getItem(key) || '[]');

// Structural ordering tests, not phone latency benchmarks. Each launch recreates
// production owners; only physical IO, navigation and native views are replaced.
// No mock resolves registerMealLog or fabricates a successful save receipt.
for (const connected of [false, true]) {
  test(`native save receives local durable success ${connected ? 'with an unresponsive socket' : 'without any socket'}`, async () => {
    const physical = disk(), app = launch(physical);
    try {
      await app.mount();
      if (connected) await app.connect(); // Never respond to pull/push.
      await act(() => app.save());
      assert.equal(app.backs, 1);
      assert.equal(app.status().saving, false);
      const pending = await queued(app);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].document.id, app.data().draftId);
      assert.equal(pending[0].document.nameSnapshot, input.name);
      assert.equal(app.sockets.length, connected ? 1 : 0);
      if (connected) assert.equal(app.sockets[0].answered.size, 0, 'no network ACK was delivered');
      await app.runDeferred();
      assert.equal(app.stores.meals.mealDocuments.length, 1);
    } finally { await app.close(); }
  });
}

test('blocked history hydration cannot retain a locally durable native save receipt', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
  physical.legacy.set(cacheKey, JSON.stringify([meal(1)]));
  let reading = false, pending;
  physical.controls.beforeRead = key => {
    if (key === cacheKey) { reading = true; return gate.promise; }
  };
  try {
    await app.mount();
    assert.equal(reading, true, 'actual provider hydration is paused');
    await act(() => { pending = app.save(); });
    assert.equal(app.backs, 1, 'history IO must not retain the native local-save receipt');
    assert.equal(app.status().saving, false);
    assert.equal((await queued(app)).length, 1, 'success requires the canonical durable outbox');
    await app.runDeferred();
    assert.equal(app.stores.meals.mealDocuments.some(doc => doc.id === app.data().draftId), true);
    assert.equal(physical.files.has(filePath(cacheKey)), false, 'pending-only state cannot replace unread history');
    gate.resolve();
    await act(() => pending);
    assert.equal(app.stores.meals.mealDocuments.length, 2, 'late history merges with the accepted local record');
    assert.equal(app.stores.meals.mealDocuments.some(doc => doc.id === meal(1).id), true);
    const cached = JSON.parse(await app.storage.getItem(cacheKey));
    assert.deepEqual(new Set(cached.map(doc => doc.id)), new Set([meal(1).id, app.data().draftId]),
      'durable consolidation preserves both unread history and the accepted pending record');
  } finally {
    gate.resolve();
    await act(() => pending);
    await app.close();
  }
});

test('outbox atomic-commit gate withholds success and repeated native callbacks cannot duplicate', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  let committing = false, pending;
  physical.controls.beforeMove = (_, destination) => {
    if (destination === filePath(outboxKey)) { committing = true; return gate.promise; }
  };
  try {
    await app.mount();
    const callback = app.props().onAction, event = app.event();
    await act(() => { pending = callback(event); });
    assert.equal(committing, true);
    assert.equal(app.backs, 0, 'temporary-file write is not a durable receipt');
    assert.equal(app.status().saving, true);
    assert.equal(physical.files.has(filePath(outboxKey)), false);
    await act(() => callback(event));
    gate.resolve();
    await act(() => pending);
    await act(() => callback(app.event(2)));
    assert.equal(app.backs, 1);
    assert.equal((await queued(app)).length, 1);
    await app.runDeferred();
    assert.equal(app.stores.meals.mealDocuments.length, 1);
  } finally { gate.resolve(); await act(() => pending); await app.close(); }
});

test('native success is observable before deferred collection-snapshot work starts', async () => {
  const physical = disk(), app = launch(physical);
  const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
  let cacheWrites = 0;
  // Seed actual cache hydration; writing this seed is outside the save action.
  physical.legacy.set(cacheKey, JSON.stringify(Array.from({ length: 20 }, (_, i) => meal(i + 1))));
  physical.controls.beforeWrite = uri => {
    if (uri.startsWith(filePath(cacheKey))) cacheWrites++;
  };
  try {
    await app.mount();
    cacheWrites = 0;
    await act(() => app.save());
    assert.equal(app.backs, 1);
    assert.equal(app.status().saving, false);
    assert.equal(cacheWrites, 0, 'whole-history cache work runs after the observable receipt');
    assert.equal((await queued(app)).length, 1);
    await app.runDeferred();
    assert.ok(cacheWrites > 0, 'deferred durable consolidation still runs');
    assert.equal(JSON.parse(await app.storage.getItem(cacheKey)).length, 21);
  } finally { await app.close(); }
});

test('genuine durable-write failure keeps the same native draft editable for retry', async () => {
  const physical = disk(), app = launch(physical);
  let fail = true;
  physical.controls.beforeMove = (_, destination) => {
    if (fail && destination === filePath(outboxKey)) throw Error('Synthetic atomic-commit failure');
  };
  try {
    await app.mount();
    const draft = app.data().draftId, session = app.data().session;
    await act(() => app.save());
    assert.equal(app.backs, 0);
    assert.equal(app.status().saving, false);
    assert.match(app.status().error, /Conservamos el formulario/);
    assert.equal(app.data().draftId, draft, 'native host retains the same draft identity');
    assert.equal(app.data().session, session, 'no remount discards native input state');
    assert.equal(app.stores.meals.mealDocuments.length, 0);
    assert.equal((await queued(app)).length, 0);
    fail = false;
    await act(() => app.save(2));
    assert.equal(app.backs, 1);
    assert.equal(app.status().error, '');
    assert.equal((await queued(app)).length, 1);
    assert.equal((await queued(app))[0].document.id, draft);
  } finally { await app.close(); }
});

test('focus loss blocks stale actions and delays navigation until the accepted save regains focus', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  let pending;
  physical.controls.beforeMove = (_, destination) => destination === filePath(outboxKey) ? gate.promise : undefined;
  try {
    await app.mount();
    const callback = app.props().onAction, event = app.event();
    await act(() => { pending = callback(event); });
    await app.setFocus(false);
    gate.resolve();
    await act(() => pending);
    assert.equal(app.backs, 0, 'hidden editor does not navigate another route');
    assert.equal((await queued(app)).length, 1);
    await act(() => callback({ nativeEvent: { ...event.nativeEvent, sequence: 2 } }));
    assert.equal((await queued(app)).length, 1);
    await app.setFocus(true);
    assert.equal(app.backs, 1);
  } finally { gate.resolve(); await act(() => pending); await app.close(); }
});

test('inactive and previous-focus session callbacks cannot start a new save', async () => {
  const physical = disk(), app = launch(physical);
  try {
    await app.mount();
    const callback = app.props().onAction, event = app.event();
    await app.setFocus(false);
    await act(() => callback(event));
    assert.equal((await queued(app)).length, 0);
    await app.setFocus(true);
    assert.notEqual(app.data().session, event.nativeEvent.session);
    await act(() => app.props().onAction(event));
    assert.equal((await queued(app)).length, 0, 'old native session is rejected after focus returns');
    await act(() => app.save());
    assert.equal(app.backs, 1);
    assert.equal((await queued(app)).length, 1);
  } finally { await app.close(); }
});

test('account change during local commit cannot publish or navigate the previous account draft', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  let pending;
  physical.controls.beforeMove = (_, destination) => destination === filePath(outboxKey) ? gate.promise : undefined;
  try {
    await app.mount();
    const callback = app.props().onAction, event = app.event(), draft = app.data().draftId;
    await act(() => { pending = callback(event); });
    await app.setUser(2);
    assert.notEqual(app.data().draftId, draft);
    gate.resolve();
    await act(() => pending);
    await act(() => callback({ nativeEvent: { ...event.nativeEvent, sequence: 2 } }));
    assert.equal(app.backs, 0);
    assert.equal(app.stores.meals.mealDocuments.length, 0);
    const firstQueue = await queued(app);
    assert.equal(firstQueue.length, 1, 'already-started durable save remains in its original namespace');
    assert.equal(firstQueue[0].document.id, draft);
    const secondKey = `@balance_sync_outbox_v2:${identity.authDataNamespace(api, 2)}`;
    assert.equal((await queued(app, secondKey)).length, 0);
  } finally { gate.resolve(); await act(() => pending); await app.close(); }
});

test('empty-conflict server ACK cannot drain the outbox before collection-cache commit', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
  let committing = false;
  physical.controls.beforeMove = (_, destination) => {
    if (destination === filePath(cacheKey)) { committing = true; return gate.promise; }
  };
  try {
    await app.mount();
    await act(() => app.save());
    assert.equal(app.backs, 1, 'outbox durability permits local success before cache consolidation');
    await app.runDeferred();
    assert.equal(committing, true);
    await app.connect();
    const socket = app.sockets.at(-1);
    const push = socket.frames.find(frame => frame.event === 'push' && frame.collection === 'mealLogs');
    assert.ok(push, 'the real sync owner submitted the pending document');
    await act(() => {
      socket.answered.add(push.requestId);
      socket.receive({ event: 'push_response', requestId: push.requestId, collection: 'mealLogs', conflicts: [], rejections: [] });
    });
    assert.equal((await queued(app)).length, 1, 'remote ACK alone cannot retire the last durable local copy');
    assert.equal(physical.files.has(filePath(cacheKey)), false);
    gate.resolve();
    for (let turn = 0; turn < 4; turn++) await act(tick);
    assert.equal((await queued(app)).length, 0);
    const cached = JSON.parse(await app.storage.getItem(cacheKey));
    assert.equal(cached.filter(doc => doc.id === app.data().draftId).length, 1);
  } finally { gate.resolve(); await act(tick); await app.close(); }
});

test('accepted outbox-only save is visible after cold restart offline and uploads once after reconnect', async () => {
  const physical = disk(), app = launch(physical);
  const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
  physical.controls.beforeMove = (_, destination) => {
    if (destination === filePath(cacheKey)) throw Error('Synthetic interrupted collection-cache commit');
  };
  let draft;
  try {
    await app.mount();
    draft = app.data().draftId;
    await act(() => app.save());
    assert.equal(app.backs, 1);
    assert.equal((await queued(app)).length, 1);
    assert.equal(physical.files.has(filePath(cacheKey)), false, 'restart must not rely on a collection snapshot');
  } finally { await app.close(); }
  physical.controls.beforeMove = undefined;
  const restarted = launch(physical);
  try {
    await restarted.mount();
    assert.equal((await queued(restarted)).length, 1);
    assert.equal(restarted.stores.meals.mealDocuments.length, 1, 'fresh providers recover accepted data from canonical outbox');
    assert.equal(restarted.stores.meals.mealDocuments[0].id, draft);
    assert.equal(restarted.sockets.length, 0);
    await restarted.connect();
    await restarted.pump();
    assert.equal((await queued(restarted)).length, 0);
    assert.equal(restarted.server.mealLogs.filter(doc => doc.id === draft).length, 1);
    assert.equal(restarted.stores.meals.mealDocuments.filter(doc => doc.id === draft).length, 1);
  } finally { await restarted.close(); }
});
