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
  const files = new Map(), legacy = new Map(), secure = new Map(), controls = {};
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
  return { files, legacy, secure, controls, native, fileSystem };
}

// Recreate every application module on each launch; only physical backends and
// the synthetic server survive. Storage, client and all four providers are real.
function launch(physical, networkMode = 'offline') {
  const serverMeals = [], requests = [];
  const TokenError = class extends Error {};
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
    'expo-auth-session': {
      TokenError, fetchDiscoveryAsync: async () => { requests.push('discovery'); return {}; },
      refreshAsync: async () => { requests.push('refresh'); if (networkMode === 'pending') return new Promise(() => {}); throw Error('Synthetic offline refresh'); },
      makeRedirectUri: () => 'balance-daily://auth-callback',
    },
    'expo-web-browser': { maybeCompleteAuthSession() {} },
    'expo-secure-store': {
      getItemAsync: async key => physical.secure.get(key) ?? null,
      setItemAsync: async (key, value) => { physical.secure.set(key, value); },
      deleteItemAsync: async key => { physical.secure.delete(key); },
    },
    'expo-constants': { expoConfig: { scheme: 'balance-daily', extra: { appVariant: 'daily' } } },
    '@/services/config': {
      API_BASE_URL: api, WS_SYNC_URL: 'wss://fixture.invalid/sync', WS_AUTH_MODE: 'application',
      OIDC_ISSUER: 'https://identity.fixture.invalid', OIDC_MOBILE_CLIENT_ID: 'fixture-mobile',
      OIDC_RESOURCE: api, OIDC_SCOPES: ['openid'], OIDC_ACCOUNT_CHOICES: false,
    },
    '@/services/import/guest-import': { recoverGuestImport: async () => null },
    '@/services/sync/official-templates': { fetchOfficialTemplates: async () => [] },
  };
  function load(filename) {
    const full = [filename, `${filename}.ts`, `${filename}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!full) return local(filename);
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} }; modules.set(full, module);
    const requireFrom = name => {
      if (name in globals) return globals[name];
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return local(name);
    };
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { fileName: full, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, WebSocket: Socket, console, __DEV__: false,
      fetch: async (url) => {
        requests.push(url);
        if (networkMode === 'pending') return new Promise(() => {});
        if (networkMode === 'offline') throw Error('Synthetic offline transport');
        return { ok: true, status: 200, json: async () => ({ data: { id: 1, email: 'synthetic@example.invalid' } }) };
      }, Headers, process: { env: {} },
      setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {}, setImmediate, URL, TextEncoder, TextDecoder }, { filename: full });
    return module.exports;
  }
  const storage = load(path.join(root, 'src/services/storage.ts')).storage;
  const owner = load(path.join(root, 'src/services/sync/sync-client.ts'));
  const client = owner.syncClient;
  const authentication = load(path.join(root, 'src/hooks/use-auth.tsx'));
  const preferences = load(path.join(root, 'src/hooks/use-preferences-store.tsx'));
  const weights = load(path.join(root, 'src/hooks/use-weight-store.tsx'));
  const meals = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const library = load(path.join(root, 'src/hooks/use-food-library-store.tsx'));
  const entry = load(path.join(root,'src/components/meal/native/native-food-entry-screen.tsx')).default;
  function Probe() {
    stores = { auth: authentication.useAuth(), meals: meals.useMealStore(), weights: weights.useWeightStore(), preferences: preferences.usePreferencesStore(), library: library.useFoodLibraryStore() };
    return React.createElement(entry);
  }
  const tree = () => React.createElement(preferences.PreferencesProvider, null,
    React.createElement(weights.WeightProvider, null, React.createElement(meals.MealStoreProvider, null,
      React.createElement(library.FoodLibraryProvider, null, React.createElement(Probe)))));
  async function mount() {
    await renderer.act(async () => {
      view = renderer.create(React.createElement(authentication.AuthProvider, null, tree()));
      for (let turn = 0; turn < 4; turn++) await tick();
    });
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
    requests, storage, client, owner, server, sockets, mount, connect, pump, close, runDeferred, setFocus, setUser,
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

for (const mode of ['fresh-offline', 'expired-offline', 'fresh-pending', 'expired-pending', 'fresh-online']) {
  test(`real AuthProvider cold start and native save: ${mode}`, async () => {
    const physical = disk();
    physical.secure.set(identity.SESSION_KEY, JSON.stringify({
      version: 2, accessToken: 'public-synthetic-access', refreshToken: 'public-synthetic-refresh',
      issuedAt: Math.floor(Date.now() / 1000) - (mode.startsWith('expired') ? 7200 : 0),
      expiresIn: 3600, lineage: 'synthetic-lineage',
      user: { id: 1, email: 'synthetic@example.invalid' },
      binding: { issuer: 'https://identity.fixture.invalid', clientId: 'fixture-mobile', resource: api, apiBaseUrl: api },
    }));
    const app = launch(physical, mode.endsWith('online') ? 'online' : mode.endsWith('pending') ? 'pending' : 'offline');
    try {
      await app.mount();
      assert.equal(app.stores.auth.user?.id, 1);
      assert.equal(app.stores.auth.isGuest, false);
      assert.equal(app.stores.auth.isLoading, false);
      await act(() => app.save());
      await app.runDeferred();
      const accountQueue = await queued(app);
      const guestQueue = await queued(app, '@balance_sync_outbox_v2:guest');
      assert.equal(app.sockets.length, mode.endsWith('online') ? 1 : 0, 'remote connection requires successful verification');
      assert.equal(app.backs, 1, 'real native editor accepted the local durable save');
      assert.equal(accountQueue.length, 1, 'cached authenticated user must select its own durable outbox offline');
      assert.equal(guestQueue.length, 0, 'authenticated save cannot enter guest queue');
    } finally { await app.close(); }
  });
}
