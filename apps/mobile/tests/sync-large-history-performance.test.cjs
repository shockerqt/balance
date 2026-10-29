const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
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
const FocusContext = React.createContext(true);
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
  let user = { id: 1 }, focused = true, dailyFocused = true, view, stores = {}, backs = 0;
  const metrics = { nativeSerializations: 0, formatterConstructions: 0, displayCalculations: 0 };
  const countedIntl = Object.create(Intl);
  countedIntl.DateTimeFormat = function (...args) { metrics.formatterConstructions++; return new Intl.DateTimeFormat(...args); };
  const countedJSON = { parse: JSON.parse, stringify(value, ...args) {
    if (value?.days && String(value.session).startsWith('daily-')) metrics.nativeSerializations++;
    return JSON.stringify(value, ...args);
  } };
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
    'expo-router': { useRouter:()=>router, useNavigation:()=>navigation, useLocalSearchParams:()=>({dateId:'2026-10-29',time:'12:30'}), useFocusEffect(cb) { const active = React.useContext(FocusContext); React.useEffect(() => active ? cb() : undefined, [cb, active]); } },
    'expo-router/react-navigation': {usePreventRemove(){}},
    '../../../../modules/balance-daily-log': { BalanceDailyLogView: props => React.createElement('native-daily', props) },
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
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, WebSocket: Socket, console, __DEV__: false, Intl: countedIntl, JSON: countedJSON,
      setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {}, setImmediate, URL, TextEncoder, TextDecoder }, { filename: full });
    if (full.endsWith('/sync/adapters.ts')) { const original = module.exports.logToLoggedFood; module.exports.logToLoggedFood = (...args) => { metrics.displayCalculations++; return original(...args); }; }
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
  const daily = load(path.join(root,'src/components/meal/native/native-daily-log-screen.tsx')).default;
  function Probe() {
    stores = { meals: meals.useMealStore(), weights: weights.useWeightStore(), preferences: preferences.usePreferencesStore(), library: library.useFoodLibraryStore() };
    return React.createElement(React.Fragment, null,
      React.createElement(FocusContext.Provider, { value: dailyFocused }, React.createElement(daily)),
      React.createElement(FocusContext.Provider, { value: focused }, React.createElement(entry)));
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
  async function runDeferredOne() {
    await renderer.act(async () => {
      const entry = [...timers].find(([, task]) => task.delay === 0);
      if (entry) { timers.delete(entry[0]); entry[1].callback(...entry[1].args); }
      await tick();
    });
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
  async function setDailyFocus(value) { dailyFocused = value; await renderer.act(async () => { view.update(tree()); await tick(); }); }
  const dailyProps = () => view.root.findByType('native-daily').props;
  const props = () => view.root.findByType('native-entry').props;
  const data = () => JSON.parse(props().data);
  const status = () => JSON.parse(props().status);
  const event = (sequence = 1, overrides = {}) => ({ nativeEvent: {
    session: data().session, sequence, action: 'save', input: JSON.stringify(input), ...overrides,
  } });
  return {
    storage, client, owner, server, sockets, mount, connect, pump, close, runDeferred, runDeferredOne, setFocus, setUser, setDailyFocus, dailyProps, metrics, load,
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

function representativeHistory(count = 12000) {
  const { EXTENDED_NUTRIENT_KEYS } = local('./src/services/sync/types.ts');
  return Array.from({ length: count }, (_, i) => ({ ...meal(i + 1),
    consumedAt: Date.UTC(2024, 8, 9, 12) + Math.floor(i / 17) * 86400000 + (i % 17) * 3000000,
    nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: {
      calories: 143.4, protein: 12.3, carbs: 16.5, fat: 3.4, fiber: 2.1, sodiumMg: 130, cholesterolMg: 10,
      extendedNutrition: Object.fromEntries(EXTENDED_NUTRIENT_KEYS.map((key, n) => [key, (n + 1) * .01234])),
    } },
  }));
}

test('outbox-only cold recovery remains visible offline when meal cache is missing or malformed', async () => {
  for (const raw of [null, '{invalid', '{}', 'null']) {
    const physical = disk(), pending = meal(9000, 2000), app = launch(physical);
    const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
    if (raw !== null) physical.legacy.set(cacheKey, raw);
    physical.legacy.set(outboxKey, JSON.stringify([{ collection: 'mealLogs', document: pending, queuedAt: 1 }]));
    try {
      await app.mount();
      assert.equal(app.sockets.length, 0);
      assert.equal(app.stores.meals.mealDocuments.length, 1);
      assert.equal(app.stores.meals.mealDocuments[0].id, pending.id);
      assert.equal((await queued(app)).length, 1);
      assert.equal(await app.storage.getItem(cacheKey), raw, 'hydration never overwrites the existing cache');
    } finally { await app.close(); }
  }
});

test('a late local projection cannot overwrite an already applied canonical conflict at the same revision', async () => {
  const physical = disk(), app = launch(physical), gate = defer();
  let committing = false;
  try {
    await app.mount(); await app.connect(); await app.pump();
    await act(() => app.save());
    const pending = (await queued(app))[0].document;
    const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
    physical.controls.beforeMove = async (from, to) => {
      if (to === filePath(cacheKey) && physical.files.get(from)?.includes('Canonical conflict')) {
        committing = true;
        await gate.promise;
      }
    };
    await app.runDeferredOne(); // Push timer only; local history timer remains queued.
    const socket = app.sockets[0], request = socket.frames.find(f => f.event === 'push');
    assert.ok(request);
    await act(() => socket.receive({ event: 'push_response', requestId: request.requestId, collection: 'mealLogs',
      conflicts: [{ ...pending, nameSnapshot: 'Canonical conflict' }], rejections: [] }));
    assert.equal(committing, true);
    assert.equal(app.stores.meals.mealDocuments[0].nameSnapshot, 'Canonical conflict');
    await app.runDeferredOne();
    assert.equal(app.stores.meals.mealDocuments[0].nameSnapshot, 'Canonical conflict');
    assert.equal((await queued(app)).length, 1, 'ACK retains the queue while consolidation is blocked');
    await act(() => gate.resolve());
    assert.equal((await queued(app)).length, 0);
    assert.equal(JSON.parse(await app.storage.getItem(cacheKey))[0].nameSnapshot, 'Canonical conflict');
  } finally { gate.resolve(); await app.close(); }
});

test('cold restart retains a durable canonical conflict when outbox retirement failed at the same revision', async () => {
  const physical = disk(), app = launch(physical);
  let canonical;
  try {
    await app.mount(); await app.connect(); await app.pump();
    await act(() => app.save());
    const pending = (await queued(app))[0].document;
    canonical = { ...pending, nameSnapshot: 'Durable canonical conflict' };
    physical.controls.beforeMove = async (from, to) => {
      if (to === filePath(outboxKey)) throw Error('Synthetic outbox retirement failure');
    };
    await app.runDeferredOne();
    const socket = app.sockets[0], request = socket.frames.find(f => f.event === 'push');
    assert.ok(request);
    await act(() => socket.receive({ event: 'push_response', requestId: request.requestId, collection: 'mealLogs',
      conflicts: [canonical], rejections: [] }));
    const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
    assert.equal(JSON.parse(await app.storage.getItem(cacheKey))[0].nameSnapshot, canonical.nameSnapshot);
    assert.equal((await queued(app))[0].document.nameSnapshot, input.name, 'original queue bytes survive failed retirement');
    assert.equal(app.client.getStatusSnapshot().error, 'local');
  } finally { await app.close(); }
  physical.controls.beforeMove = undefined;
  const restarted = launch(physical);
  try {
    await restarted.mount();
    assert.equal(restarted.sockets.length, 0, 'cold recovery must work without a remote correction');
    assert.equal(restarted.stores.meals.mealDocuments[0].nameSnapshot, canonical.nameSnapshot);
    assert.equal(restarted.stores.meals.mealDocuments[0].updatedAt, canonical.updatedAt);
    assert.equal((await queued(restarted)).length, 1, 'read recovery does not silently remove retryable outbox data');
  } finally { await restarted.close(); }
});

test('incremental complete-day projection is equivalent across edits, weights, tombstones, reorder and replacement', () => {
  const app = launch(disk());
  const store = app.load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const adapter = app.load(path.join(root, 'src/services/sync/adapters.ts'));
  const dates = app.load(path.join(root, 'src/lib/dates.ts'));
  const contract = app.load(path.join(root, 'src/components/meal/native/interface-contract.ts'));
  const projectLogs = store.createMealDayProjector(), projectDays = contract.createInterfaceDaysProjector();
  const fullLogs = docs => {
    const result = {};
    for (const doc of docs) {
      if (doc._deleted) continue;
      const date = dates.toDateId(new Date(doc.consumedAt));
      (result[date] ??= store.emptyDayLog(date)).foods.push(adapter.logToLoggedFood(doc));
    }
    return result;
  };
  let docs = representativeHistory(100), weights = {};
  let last;
  function check() {
    const logs = projectLogs(docs), actual = projectDays(logs, weights, docs);
    const expectedLogs = fullLogs(docs);
    assert.equal(JSON.stringify(logs), JSON.stringify(expectedLogs));
    assert.equal(JSON.stringify(actual), JSON.stringify(contract.projectInterfaceDays(expectedLogs, weights, docs)));
    last = { logs, actual };
  }
  check();
  const unchanged = last;
  check();
  for (const date in last.actual) assert.equal(last.actual[date], unchanged.actual[date]);
  docs = [...docs];
  docs[0] = { ...docs[0], canonicalQuantity: 150, consumedAt: dates.epochForChileDateTime('2026-04-05', '23:30'),
    entry: { enteredQuantity: 1.5, portionSnapshot: { name: 'taza', portionId: 'cup', portionQuantity: 1, canonicalQuantity: 100 } }, updatedAt: 2000 };
  check();
  const beforeRevision = last;
  // A canonical-only revision must invalidate native detail refs even when a
  // caller supplies an unchanged DayLog reference.
  docs[1] = { ...docs[1], updatedAt: 2001 };
  assert.notEqual(projectDays(beforeRevision.logs, weights, docs)[dates.toDateId(new Date(docs[1].consumedAt))],
    beforeRevision.actual[dates.toDateId(new Date(docs[1].consumedAt))]);
  check();
  docs[2] = { ...docs[2], _deleted: true, updatedAt: 3000 };
  check();
  docs.reverse(); check();
  weights = { '2025-01-01': { id: '2025-01-01', weightGrams: 72100, updatedAt: 1, _deleted: false } };
  check();
  weights = { '2025-01-01': { ...weights['2025-01-01'], weightGrams: 72200, updatedAt: 2 } }; check();
  docs = docs.slice(0, 1); weights = {}; check();
  assert.equal(Object.keys(last.actual).length, 1, 'old dates disappear after canonical replacement');
  docs = []; check(); assert.deepEqual(Object.keys(last.actual), []);
});

test('12k history advances 240 unique pages with actual owners and a retained native diary; local receipt precedes history work', { timeout: 180000 }, async t => {
  const physical = disk(), history = representativeHistory(), app = launch(physical, history);
  const cacheKey = app.owner.collectionStorageKey(namespace, 'mealLogs');
  const start = performance.now();
  try {
    await app.mount();
    await app.setDailyFocus(false);
    const hiddenData = app.dailyProps().data, hiddenSerializations = app.metrics.nativeSerializations;
    await app.connect();
    let appliedAtSave = 0, localReceiptMs = 0, saved = false;
    const stop = () => {
      const count = app.client.getStatusSnapshot().receivedDocuments;
      if (!saved && count >= 6000) { appliedAtSave = count; return true; }
      return app.client.getStatusSnapshot().phase === 'synced';
    };
    await app.pump(stop);
    assert.ok(appliedAtSave >= 6000, 'save interleaves the real finite pull lifecycle');
    const beforeDocuments = app.stores.meals.mealDocuments, beforeCalculations = app.metrics.displayCalculations;
    const receiptStart = performance.now();
    await act(() => app.save());
    localReceiptMs = performance.now() - receiptStart;
    saved = true;
    assert.equal(app.backs, 1);
    assert.equal(app.status().saving, false);
    assert.equal(app.stores.meals.mealDocuments, beforeDocuments, 'receipt is observable before heavy merge/projection');
    assert.equal(app.metrics.displayCalculations, beforeCalculations);
    assert.equal((await queued(app)).length, 1);
    assert.ok(localReceiptMs < 250, `Node/ARM local receipt ${localReceiptMs.toFixed(1)}ms exceeds 250ms budget`);
    await app.runDeferred();
    await app.pump();
    assert.equal(app.stores.meals.mealDocuments.length, 12001);
    assert.equal(JSON.parse(await app.storage.getItem(cacheKey)).length, 12001);
    assert.equal((await queued(app)).length, 0);
    assert.equal(app.dailyProps().data, hiddenData, 'blurred host retains its data prop, including after local save');
    assert.equal(app.metrics.nativeSerializations, hiddenSerializations, 'blurred host performs zero payload serializations');
    const frames = app.sockets[0].frames.filter(f => f.event === 'pull' && f.collection === 'mealLogs');
    const checkpointIds = frames.map(f => f.checkpoint?.id ?? 'initial');
    assert.equal(new Set(checkpointIds).size, checkpointIds.length, 'no replay of a completed frontier');
    assert.equal(frames.slice(0, 240).length, 240);
    assert.equal(app.metrics.formatterConstructions, 2, 'date and time formatters are constant per fresh runtime');
    assert.ok(app.metrics.displayCalculations <= 12003, 'unchanged canonical documents are adapted once');
    await app.setDailyFocus(true);
    const data = JSON.parse(app.dailyProps().data);
    assert.ok(Object.keys(data.days).length >= 706, 'all historical dates remain available');
    assert.equal(Object.values(data.days).reduce((count, day) => count + day.foods.length, 0), 12001);
    assert.equal(app.metrics.nativeSerializations, hiddenSerializations + 1, 'focus refreshes latest complete payload once');
    const contract = app.load(path.join(root, 'src/components/meal/native/interface-contract.ts'));
    assert.equal(JSON.stringify(data.days), JSON.stringify(contract.projectInterfaceDays(app.stores.meals.dayLogs, app.stores.weights.weightsByDate, app.stores.meals.mealDocuments)));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 120000, `Node/ARM synthetic lifecycle ${elapsed.toFixed(1)}ms exceeds 120s budget`);
    t.diagnostic(JSON.stringify({ runtime: process.version, arch: process.arch, documents: 12001, pages: frames.length,
      days: Object.keys(data.days).length, cacheBytes: Buffer.byteLength(await app.storage.getItem(cacheKey)),
      nativeBytes: Buffer.byteLength(app.dailyProps().data), localReceiptMs, elapsedMs: elapsed, ...app.metrics,
      limits: 'Node React renderer; simulated native FS/socket/host; no Hermes/Kotlin/phone paint or radio timing' }));
    const complete = app.server.mealLogs;
    await app.close();
    const restarted = launch(physical, complete);
    try {
      await restarted.mount(); await restarted.setDailyFocus(false); await restarted.connect(); await restarted.pump();
      assert.equal(restarted.stores.meals.mealDocuments.length, 12001);
      assert.equal(restarted.client.getStatusSnapshot().receivedDocuments, 0, 'sound durable cursor resumes without history replay');
    } finally { await restarted.close(); }
  } finally { await app.close(); }
});
