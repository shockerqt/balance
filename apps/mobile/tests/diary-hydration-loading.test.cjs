const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const React = local('react');
const { act, create } = local('react-test-renderer');
const ts = local('typescript');
const dates = local('./src/lib/dates.ts');
const navigation = local('./src/lib/log-navigation.ts');

global.IS_REACT_ACT_ENVIRONMENT = true;

const host = name => props => React.createElement(name, props, props.children);

function textContent(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textContent).join('');
}

function createHarness(initialToday = '2026-11-15') {
  let account = 1;
  const pendingReads = [];
  const cache = new Map();
  const sync = {
    registerCollection: () => () => {},
    pendingDocuments: async () => [],
    invalidateCollectionCheckpoint: async () => {},
    reportLocalPersistenceError: () => {},
  };

  function load(filename, extraStubs = {}) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;

    const requireLocal = name => {
      if (name in extraStubs) return extraStubs[name];
      if (name === '@/services/config') return { API_BASE_URL: 'https://fixture.invalid/api' };
      if (name === './use-auth' || name === '@/hooks/use-auth') return { useAuth: () => ({ user: { id: account } }) };
      if (name === '@/services/storage') {
        return {
          storage: {
            getItem: key => new Promise(resolve => pendingReads.push({ key, resolve })),
            getJsonItem: key => new Promise(resolve => pendingReads.push({ key, resolve })),
            setItem: async () => {},
            setJsonItem: async () => {},
            removeItem: async () => {},
            removeJsonItem: async () => {},
            isDurableItem: () => true,
          },
        };
      }
      if (name === '@/services/import/guest-import') return { recoverGuestImport: async () => {} };
      if (name === '@/services/sync/sync-client') {
        return { syncClient: sync, collectionStorageKey: (namespace, collection) => `${namespace}:${collection}` };
      }
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (resolved) return load(resolved, extraStubs);
      }
      return local(name);
    };

    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(requireLocal, module, module.exports);
    return module.exports;
  }

  const store = load(path.join(root, 'src/hooks/use-meal-store.tsx'));
  const nav = navigation.createLogNavigation(initialToday);
  const diaryStubs = {
    react: React,
    'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), Alert: { alert() {} } },
    'expo-router': { useRouter: () => ({ push() {} }), useFocusEffect: fn => React.useEffect(fn, [fn]) },
    'expo-router/react-navigation': { useIsFocused: () => true },
    'expo-crypto': { randomUUID: () => require('node:crypto').randomUUID() },
    'react-native-reanimated': {
      __esModule: true,
      default: { View: host('AnimatedView') },
      useAnimatedStyle: () => ({}),
      useAnimatedReaction: () => {},
      runOnJS: fn => fn,
      useSharedValue: initial => React.useRef({ value: initial }).current,
    },
    '@/components/ui': { Button: host('Button'), Card: host('Card'), Text: host('Text') },
    '@/hooks/use-meal-store': store,
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ dailyCalorieTarget: 2200, diaryMacrosEnabled: false }) },
    '@/hooks/use-food-selection': { useFoodSelection: () => ({ clear() {}, selectedIds: new Set(), isSelectionMode: false, selectedCount: 0 }) },
    '@/hooks/use-logs-date': {
      logsDateStore: nav,
      useLogsSelectedDate: () => [initialToday, () => {}],
      useLogsDateRevision: () => 0,
    },
    '@/lib/dates': dates,
    './date-strip-header': { DateStripHeader: host('DateStripHeader') },
    './sticky-macro-header': { StickyMacroHeader: host('StickyMacroHeader') },
    './native-day-window': { NativeDayWindow: props => React.createElement('Pager', props, props.renderDay(props.dateId)) },
    './interactive-day-window': { InteractiveDayWindow: host('RingPager') },
    './legend-day-window': { LegendDayWindow: host('LegendPager') },
    './meal-group-feed': {
      MealGroupFeed: props => React.createElement('MealGroupFeed', props, props.foods.length === 0 ? props.empty : null),
    },
  };

  const { ReactNativeDiary } = load(path.join(root, 'src/components/meal/react-native-diary.tsx'), diaryStubs);

  return {
    store,
    ReactNativeDiary,
    pendingReads,
    setAccount: next => { account = next; },
  };
}

test('diary shows loading skeleton until meal store hydrates, then renders empty state or hydrated foods', async () => {
  const today = '2026-11-15';
  const h = createHarness(today);
  let snapshot;
  let hydratedFlag;

  function Probe() {
    snapshot = h.store.useMealStore();
    hydratedFlag = h.store.useMealHydrated();
    return null;
  }

  function App() {
    return React.createElement(
      h.store.MealStoreProvider,
      null,
      React.createElement(Probe),
      React.createElement(h.ReactNativeDiary, { today })
    );
  }

  let tree;
  await act(async () => {
    tree = create(React.createElement(App));
  });

  try {
    assert.equal(snapshot.hydrated, false);
    assert.equal(hydratedFlag, false);
    assert.equal(h.pendingReads.length, 1);

    // AC-1: skeleton/loading state is shown; never empty-day message or zero totals (StickyMacroHeader)
    const loadingNodes = tree.root.findAllByType('View').filter(n => n.props.accessibilityLabel === 'Cargando registros del día');
    assert.equal(loadingNodes.length, 1);
    assert.equal(loadingNodes[0].props.accessibilityRole, 'progressbar');
    assert.deepEqual(loadingNodes[0].props.accessibilityState, { busy: true });
    assert.equal(tree.root.findAllByType('StickyMacroHeader').length, 0);
    assert.equal(tree.root.findAllByType('MealGroupFeed').length, 0);
    assert.equal(textContent(tree.toJSON()).includes('Sin registros este día'), false);

    // Resolve manifest + legacy as empty -> AC-2: empty day shows empty state
    await act(async () => {
      h.pendingReads.shift().resolve(null);
      await new Promise(resolve => setImmediate(resolve));
    });
    await act(async () => {
      h.pendingReads.shift().resolve(null);
      await new Promise(resolve => setImmediate(resolve));
    });

    assert.equal(snapshot.hydrated, true);
    assert.equal(hydratedFlag, true);
    assert.equal(tree.root.findAllByType('View').filter(n => n.props.accessibilityLabel === 'Cargando registros del día').length, 0);
    assert.equal(tree.root.findAllByType('StickyMacroHeader').length, 2);
    assert.equal(tree.root.findAllByType('MealGroupFeed').length, 1);
    assert.equal(textContent(tree.toJSON()).includes('Sin registros este día'), true);

    // Account switch resets hydrated to false immediately and shows skeleton until new cache resolves
    h.setAccount(2);
    await act(async () => {
      tree.update(React.createElement(App));
    });

    assert.equal(snapshot.hydrated, false);
    assert.equal(hydratedFlag, false);
    assert.equal(h.pendingReads.length, 1);
    assert.equal(tree.root.findAllByType('View').filter(n => n.props.accessibilityLabel === 'Cargando registros del día').length, 1);
    assert.equal(tree.root.findAllByType('StickyMacroHeader').length, 0);
    assert.equal(textContent(tree.toJSON()).includes('Sin registros este día'), false);

    const meal = {
      id: 'meal-1',
      templateId: null,
      nameSnapshot: 'Avena',
      nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 380, protein: 13, carbs: 66, fat: 7 } },
      canonicalQuantity: 100,
      entry: { enteredQuantity: 100 },
      consumedAt: dates.epochForChileDateTime(today, '08:00'),
      updatedAt: 1,
      _deleted: false,
    };
    const historicalMeal = {
      ...meal,
      id: 'meal-old',
      nameSnapshot: 'Almuerzo histórico',
      consumedAt: dates.epochForChileDateTime('2025-10-10', '13:00'),
    };

    // Resolve manifest for account 2 with current month (2026-11) + historical month (2025-10)
    await act(async () => {
      h.pendingReads.shift().resolve({
        version: 1,
        complete: true,
        durable: true,
        months: ['2025-10', '2026-11'],
      });
      await new Promise(resolve => setImmediate(resolve));
    });

    // Resolve only the visible-window shard (2026-11) -> diary hydrates & renders immediately
    // even while the historical shard (2025-10) is still pending!
    assert.equal(h.pendingReads.length, 1);
    assert.ok(h.pendingReads[0].key.endsWith(':month:2026-11'));
    await act(async () => {
      h.pendingReads.shift().resolve({ version: 1, month: '2026-11', documents: [meal] });
      await new Promise(resolve => setImmediate(resolve));
    });

    assert.equal(snapshot.hydrated, true);
    assert.equal(hydratedFlag, true);
    const visibleDocRef = snapshot.mealDocuments.find(d => d.id === 'meal-1');
    assert.ok(visibleDocRef);
    const headers = tree.root.findAllByType('StickyMacroHeader');
    assert.equal(headers.length, 2);
    assert.equal(headers[0].props.foods.length, 1);
    assert.equal(headers[0].props.foods[0].name, 'Avena');
    assert.equal(textContent(tree.toJSON()).includes('Sin registros este día'), false);

    // Historical shard loads in background without replacing visible-window MealLogDoc reference
    assert.equal(h.pendingReads.length, 1);
    assert.ok(h.pendingReads[0].key.endsWith(':month:2025-10'));
    await act(async () => {
      h.pendingReads.shift().resolve({ version: 1, month: '2025-10', documents: [historicalMeal] });
      await new Promise(resolve => setImmediate(resolve));
    });
    assert.equal(snapshot.mealDocuments.length, 2);
    assert.equal(snapshot.mealDocuments.find(d => d.id === 'meal-1'), visibleDocRef);
  } finally {
    await act(async () => tree.unmount());
  }
});
