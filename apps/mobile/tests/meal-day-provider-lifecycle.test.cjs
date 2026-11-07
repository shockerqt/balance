const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const React = local('react'), { act, create } = local('react-test-renderer'), ts = local('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('actual provider isolates date subscriptions, stable actions and account replacement', async () => {
  let account = 1;
  const cache = new Map();
  const sync = { registerCollection: () => () => {}, pendingDocuments: async () => [] };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const requireLocal = name => {
      if (name === '@/services/config') return { API_BASE_URL: 'https://fixture.invalid/api' };
      if (name === './use-auth') return { useAuth: () => ({ user: { id: account } }) };
      if (name === '@/services/storage') return { storage: { getItem: async () => null } };
      if (name === '@/services/import/guest-import') return { recoverGuestImport: async () => {} };
      if (name === '@/services/sync/sync-client') return { syncClient: sync, collectionStorageKey: (namespace, collection) => `${namespace}:${collection}` };
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (resolved) return load(resolved);
      }
      return local(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(requireLocal, module, module.exports);
    return module.exports;
  }
  const store = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const dates = load(path.join(root, 'src/lib/dates.ts'));
  const meal = (id, date) => ({ id, templateId: null, nameSnapshot: id,
    nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 1 } },
    canonicalQuantity: 100, entry: { enteredQuantity: 100 }, consumedAt: dates.epochForChileDateTime(date, '08:00'), updatedAt: 1, _deleted: false });
  let owner, actions;
  const renders = { a: 0, b: 0, empty: 0, actions: 0 }, snapshots = {}, seen = [];
  function Control() { owner = store.useMealStore(); return null; }
  function Actions() { renders.actions++; actions = store.useMealActions(); return null; }
  function Day({ name, date }) {
    renders[name]++; snapshots[name] = store.useMealDay(date);
    seen.push({ account, name, foods: snapshots[name].foods.map(f => f.name) });
    return null;
  }
  function App() {
    return React.createElement(store.MealStoreProvider, null,
      React.createElement(Control), React.createElement(Actions),
      React.createElement(Day, { name: 'a', date: '2026-11-06' }),
      React.createElement(Day, { name: 'b', date: '2026-11-05' }),
      React.createElement(Day, { name: 'empty', date: '2040-01-01' }));
  }
  let tree;
  await act(async () => { tree = create(React.createElement(App)); await new Promise(resolve => setImmediate(resolve)); });
  const a = meal('a', '2026-11-06'), b = meal('b', '2026-11-05');
  await act(() => owner.replaceMealDocuments([a, b]));
  const counts = { ...renders }, stableActions = actions, stableB = snapshots.b;
  await act(() => owner.replaceMealDocuments([{ ...a, nameSnapshot: 'Edited' }, b]));
  assert.equal(renders.a, counts.a + 1);
  assert.equal(renders.b, counts.b);
  assert.equal(renders.empty, counts.empty);
  assert.equal(renders.actions, counts.actions);
  assert.equal(actions, stableActions);
  assert.equal(snapshots.b, stableB);
  assert.equal(snapshots.a.foods[0].name, 'Edited');
  const moved = { ...a, consumedAt: b.consumedAt };
  await act(() => owner.replaceMealDocuments([moved, b]));
  assert.equal(snapshots.a.foods.length, 0);
  assert.equal(snapshots.b.foods.length, 2);
  account = 2;
  await act(async () => { tree.update(React.createElement(App)); await new Promise(resolve => setImmediate(resolve)); });
  assert.ok(seen.filter(value => value.account === 2).every(value => value.foods.length === 0));
  await act(() => tree.unmount());
});
