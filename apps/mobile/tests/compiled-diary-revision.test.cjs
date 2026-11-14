const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), babel = local('@babel/core'), ts = local('typescript');
const dates = local('./src/lib/dates.ts'), navigation = local('./src/lib/log-navigation.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
const animatedParent = node => { let parent = node.parent; while (parent && parent.type !== 'AnimatedView') parent = parent.parent; return parent; };
// Use Expo's production preset and the React Compiler enabled by app.json.
// A TS-only renderer cannot catch memoization of imperative external-store reads.
function compile(file, stubs) {
  const filename = path.join(root, file);
  const compiled = babel.transformFileSync(filename, { babelrc: false, configFile: false, compact: false,
    presets: [['babel-preset-expo', {}]],
    caller: { name: 'metro', platform: 'android', isDev: false, isServer: false, bundler: 'metro', supportsStaticESM: true, supportsReactCompiler: true },
  }).code;
  assert.match(compiled, /react\/compiler-runtime/, 'the regression must execute compiler output');
  const m = new Module(filename, module); m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; if (name.startsWith('@babel/runtime/') || name === 'react/compiler-runtime') return local(name); throw Error('Unexpected dependency '+name); };
  const code = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  m._compile('const __DEV__ = false;\n'+code, filename);
  return m.exports;
}
async function harness(renderDays = false) {
  const pushes = [], shared = [], resets = [], reactions = [];
  let commits = 0;
  const food = { id: 'food-1', name: 'Avena', portion: '100 g', calories: 100, protein: 5, carbs: 10, fat: 2 };
  const log = { foods: [food] };
  const clear = () => {};
  const selection = { clear, selectedIds: new Set(), isSelectionMode: false };
  const hooks = compile('src/hooks/use-logs-date.ts', {
    react: React, '@/lib/dates': { ...dates, todayId: () => '2026-11-08' }, '@/lib/log-navigation': navigation,
    '@/dev/log-performance': { beginLogNavigation() {}, installLogPerformance() {} },
  });
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), Alert: { alert() {} } },
    'expo-router': { useRouter: () => ({ push: value => pushes.push(value) }), useFocusEffect: fn => React.useEffect(fn, [fn]) }, 'expo-router/react-navigation': { useIsFocused: () => true },
    'react-native-reanimated': { __esModule: true, default: { View: host('AnimatedView') }, useAnimatedStyle: fn => ({ read: fn }), useAnimatedReaction(prepare, react) { React.useEffect(() => { const r = { prepare, react, previous: null }; reactions.push(r); return () => reactions.splice(reactions.indexOf(r), 1); }); }, runOnJS: fn => fn, useSharedValue: initial => { const ref = React.useRef(null); if (!ref.current) { ref.current = { value: initial }; shared.push(ref.current); } return ref.current; } },
    '@/components/ui': { Button: host('Button'), Card: host('Card'), Text: host('Text') },
    '@/components/weight/daily-weight-row': { DailyWeightRow: host('DailyWeightRow') }, '@/hooks/use-meal-store': { useMealDay: () => log, useMealActions: () => ({ deleteMultipleFoods() {} }) }, '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true, diaryMacrosEnabled: false }) },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: {} }) }, '@/hooks/use-food-selection': { useFoodSelection: () => selection }, '@/hooks/use-logs-date': hooks, '@/lib/dates': dates,
    './date-strip-header': { DateStripHeader: props => React.createElement('Header', { ...props, date: props.selectedDateId, week: dates.getMondayDateId(props.selectedDateId) }) },
    './sticky-macro-header': { StickyMacroHeader: host('Summary') },
    './native-day-window': { NativeDayWindow: props => React.createElement('Pager', props, renderDays
      ? (renderDays === 'window' ? Array.from({ length: 15 }, (_, i) => dates.shiftDateId('2026-11-08', i - 7)) : [props.dateId])
        .map(day => React.createElement('Page', { key: day, date: day }, props.renderDay(day))) : null) },
    './interactive-day-window': { InteractiveDayWindow: props => React.createElement('RingPager', props, props.renderDay(props.dateId)) },
    './legend-day-window': { LegendDayWindow: props => React.createElement('LegendPager', props, props.renderDay(props.dateId)) },
    './meal-group-feed': { MealGroupFeed: props => { React.useImperativeHandle(props.ref, () => ({ resetScroll: () => resets.push(true) })); return React.createElement('Feed', props); } },
  };
  const { ReactNativeDiary } = compile('src/components/meal/react-native-diary.tsx', stubs);
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(React.Profiler, { id: 'diary', onRender: () => commits++ }, React.createElement(ReactNativeDiary, { today: '2026-11-08' }))); });
  const feed = (day = hooks.logsDateStore.get()) => tree.root.findAllByType('Page').find(node => node.props.date === day).findByType('Feed');
  return { tree, shared, pushes, resets, food, feed, commits: () => commits,
    async frame(offset, day) { await renderer.act(async () => {
      feed(day).props.scrollOffset.value = offset;
      for (let pass = 0; pass < 2; pass++) for (const r of [...reactions]) {
        const next = r.prepare();
        if (JSON.stringify(next) !== JSON.stringify(r.previous)) { const previous = r.previous; r.previous = next; r.react(next, previous); }
      }
    }); }, nav: hooks.logsDateStore, pager: () => tree.root.findByType('Pager').props, header: () => tree.root.findByType('Header').props,
    async swipe(next) { await renderer.act(async () => { const p = tree.root.findByType('Pager').props; p.onSettle(next, p.revision); }); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}

test('production-compiled diary advances both date and live revision on consecutive native settles across a week', async () => {
  const h = await harness();
  try {
    await h.swipe('2026-11-09'); assert.equal(h.header().date, '2026-11-09'); assert.equal(h.header().week, '2026-11-09');
    assert.equal(h.pager().revision, 1, 'the compiler must not freeze the mount revision');
    await h.swipe('2026-11-10'); assert.equal(h.header().date, '2026-11-10'); assert.equal(h.pager().revision, 2);
  } finally { await h.close(); }
});

test('compiled full day window keeps one clipped global header outside every native page', async () => {
  const h = await harness('window');
  try {
    const headers = h.tree.root.findAllByType('Header');
    assert.equal(headers.length, 1);
    assert.equal(h.tree.root.findAllByType('Page').length, 15);
    assert.ok(h.tree.root.findAllByType('Page').every(page => page.findAllByType('Header').length === 0));
    let parent = headers[0].parent;
    while (parent) { assert.notEqual(parent.type, 'Pager'); parent = parent.parent; }
    const clip = animatedParent(headers[0]);
    assert.equal(clip.props.style[0].position, 'absolute');
    assert.equal(clip.props.style[0].overflow, 'hidden');
    assert.equal(clip.props.style[1].read().height, 136);
    assert.equal(h.header().pagerPosition, h.pager().position);
    assert.equal(h.header().pagerInteraction, h.pager().interaction);
    const source = h.feed();
    await h.frame(54);
    assert.equal(h.header().collapseScroll.value, 54);
    assert.equal(clip.props.style[1].read().height, 121.5);
    await h.frame(160, '2026-11-09');
    assert.equal(h.header().collapseScroll.value, 54, 'offscreen scroll never owns the global header');
    await h.swipe('2026-11-09');
    assert.equal(h.tree.root.findAllByType('Header').length, 1);
    assert.equal(h.header().date, '2026-11-09');
    assert.equal(h.header().collapseScroll.value, 0);
    assert.equal(h.feed().props.scrollOffset.value, 0, 'the canonical destination retains the earlier scroll reset owner');
    assert.equal(h.pager().scrollEnabled, true);
    const before = h.pushes.length;
    await renderer.act(async () => source.props.onSelectFood(h.food));
    assert.equal(h.pushes.length, before, 'an old day callback cannot edit the canonical destination');
    await renderer.act(async () => h.feed().props.onSelectFood(h.food));
    assert.deepEqual(h.pushes.pop(), { pathname: '/food-edit', params: { dateId: '2026-11-09', foodId: 'food-1' } });
  } finally { await h.close(); }
});

test('production-compiled calendar jump to Sunday 6 preserves the following native swipe acknowledgement', async () => {
  const h = await harness();
  try {
    await renderer.act(async () => h.nav.set('2026-12-06'));
    assert.equal(h.header().date, '2026-12-06');
    await h.swipe('2026-12-07');
    assert.equal(h.header().date, '2026-12-07'); assert.equal(h.header().week, '2026-12-07'); assert.equal(h.pager().revision, 2);
  } finally { await h.close(); }
});

test('production-compiled away-and-back calendar commands update the revision even when the final date is unchanged', async () => {
  const h = await harness();
  try {
    await renderer.act(async () => { h.nav.set('2040-01-01'); h.nav.set('2026-11-08'); });
    assert.equal(h.header().date, '2026-11-08'); assert.equal(h.pager().revision, 2);
    await h.swipe('2026-11-09'); assert.equal(h.header().date, '2026-11-09');
  } finally { await h.close(); }
});

test('compiled diary keeps 1/3 geometry, omits weight, edits food and resets after date change', async () => {
  const h = await harness(true);
  try {
    assert.equal(h.tree.root.findAllByType('DailyWeightRow').length, 0);
    const header = h.tree.root.findAllByType('AnimatedView')[0];
    const summary = h.tree.root.findAllByType('AnimatedView')[1];
    const expanded = header.props.style[1].read().height + summary.props.style[1].read().height;
    const feed = h.tree.root.findByType('Feed');
    h.shared[0].value = 216; feed.props.scrollOffset.value = 216;
    const compact = header.props.style[1].read().height + summary.props.style[1].read().height;
    assert.equal(expanded, 324); assert.equal(compact, 108); assert.ok(compact <= expanded / 3);
    await renderer.act(async () => feed.props.onSelectFood(h.food));
    assert.deepEqual(h.pushes.pop(), { pathname: '/food-edit', params: { dateId: '2026-11-08', foodId: 'food-1' } });
    await h.swipe('2026-11-09'); await h.swipe('2026-11-08');
    assert.equal(h.tree.root.findByType('Feed').props.scrollOffset.value, 0);
    assert.ok(h.resets.length > 0);
  } finally { await h.close(); }
});

test('compiled diary hides clipped summary from TalkBack and continuous frames do not commit React', async () => {
  const h = await harness(true);
  try {
    await h.frame(10); await h.frame(20);
    const commits = h.commits();
    for (const offset of [30, 40, 50, 60]) await h.frame(offset);
    assert.equal(h.commits(), commits, 'continuous scroll within a mode must stay on UI thread');
    const expanded = h.tree.root.findAllByType('Summary').find(n => !n.props.compact);
    const accessibleParent = node => { while (node && node.props.accessibilityElementsHidden === undefined) node = node.parent; return node; };
    assert.equal(accessibleParent(expanded).props.accessibilityElementsHidden, true);
    assert.equal(accessibleParent(expanded).props.importantForAccessibility, 'no-hide-descendants');
    const compact = h.tree.root.findAllByType('Summary').find(n => n.props.compact);
    assert.equal(accessibleParent(compact).props.accessibilityElementsHidden, false);
    assert.equal(accessibleParent(compact).props.pointerEvents, 'auto');
    await h.frame(0);
    assert.equal(accessibleParent(expanded).props.accessibilityElementsHidden, false);
    assert.equal(accessibleParent(expanded).props.pointerEvents, 'auto');
    await h.frame(1);
    assert.equal(accessibleParent(expanded).props.accessibilityElementsHidden, true);
    assert.equal(accessibleParent(compact).props.pointerEvents, 'auto');
    assert.equal(h.header().compact, false, 'the header retains its separate 108dp handoff');
    await h.frame(108);
    assert.equal(h.header().compact, true);
    await renderer.act(async () => compact.props.onPress());
    assert.deepEqual(h.pushes.pop(), { pathname: '/day-nutrition', params: { dateId: '2026-11-08' } });
    await h.frame(0);
    assert.equal(accessibleParent(h.tree.root.findAllByType('Summary').find(n => !n.props.compact)).props.accessibilityElementsHidden, false);
  } finally { await h.close(); }
});

test('compiled summary restores the historical quick fade and fixed clip without a new lift', async () => {
  const h = await harness(true);
  const face = compact => animatedParent(h.tree.root.findAllByType('Summary').find(n => !!n.props.compact === compact));
  try {
    for (const [offset, fullAlpha, compactAlpha] of [[0, 1, 0], [36, .5, 0], [54, .25, 0], [72, 0, 1 / 9], [108, 0, 1 / 3], [216, 0, 1]]) {
      await h.frame(offset);
      const p = Math.min(1, Math.max(0, offset / 216));
      const expanded = face(false).props.style.read();
      const compact = face(true).props.style[1].read();
      assert.ok(Math.abs(expanded.opacity - fullAlpha) < 1e-12);
      assert.ok(Math.abs(compact.opacity - compactAlpha) < 1e-12);
      assert.equal(expanded.transform, undefined, 'the historical summary face has no translation');
      const clip = animatedParent(face(false));
      assert.equal(clip.props.style[0].overflow, 'hidden');
      assert.equal(clip.props.style[1].read().top, 136 - 58 * p);
      assert.equal(clip.props.style[1].read().height, 188 - 158 * p);
    }
  } finally { await h.close(); }
});

test('changing the weight of one date re-renders only that date subscriber via useWeightForDate', async () => {
  const { createWeightDaySubscriptions, useWeightForDate, WeightProvider } = compile('src/hooks/use-weight-store.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    '@/services/config': { API_BASE_URL: 'https://example.test/api' },
    '@/services/auth/session-state': { authDataNamespace: () => 'guest' },
    '@/hooks/use-auth': { useAuth: () => ({ user: null }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true }) },
    '@/hooks/use-meal-store': { todayId: () => '2026-11-08' },
    '@/services/storage': { storage: { getItem: async () => null, setItem: async () => {}, isDurableItem: () => true } },
    '@/services/sync/sync-client': { collectionStorageKey: () => 'weights', syncClient: {
      invalidateCollectionCheckpoint: async () => {}, reportLocalPersistenceError() {},
      registerCollection: () => () => {}, enqueue: async () => {},
    } },
    '@/services/sync/types': local('./src/services/sync/types.ts'),
    '@/services/weight/weight': local('./src/services/weight/weight.ts'),
  });
  const sub = createWeightDaySubscriptions({
    '2026-11-08': { id: '2026-11-08', weightGrams: 70000, updatedAt: 1, _deleted: false },
    '2026-11-09': { id: '2026-11-09', weightGrams: 70500, updatedAt: 1, _deleted: false },
  });
  let notified8 = 0, notified9 = 0;
  sub.subscribe('2026-11-08', () => notified8++);
  sub.subscribe('2026-11-09', () => notified9++);
  sub.publish({
    '2026-11-08': sub.get('2026-11-08'),
    '2026-11-09': { id: '2026-11-09', weightGrams: 71000, updatedAt: 2, _deleted: false },
  });
  assert.equal(notified8, 0, 'untouched date does not notify');
  assert.equal(notified9, 1, 'changed date notifies once');

  const renders = { '2026-11-07': 0, '2026-11-08': 0, '2026-11-09': 0 };
  let save;
  const { useWeightStore } = compile('src/hooks/use-weight-store.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    '@/services/config': { API_BASE_URL: 'https://example.test/api' },
    '@/services/auth/session-state': { authDataNamespace: () => 'guest' },
    '@/hooks/use-auth': { useAuth: () => ({ user: null }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true }) },
    '@/hooks/use-meal-store': { todayId: () => '2026-11-10' },
    '@/services/storage': { storage: { getItem: async () => null, setItem: async () => {}, isDurableItem: () => true } },
    '@/services/sync/sync-client': { collectionStorageKey: () => 'weights', syncClient: {
      invalidateCollectionCheckpoint: async () => {}, reportLocalPersistenceError() {},
      registerCollection: () => () => {}, enqueue: async () => {},
    } },
    '@/services/sync/types': local('./src/services/sync/types.ts'),
    '@/services/weight/weight': local('./src/services/weight/weight.ts'),
  });
  const weightMod = compile('src/hooks/use-weight-store.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    '@/services/config': { API_BASE_URL: 'https://example.test/api' },
    '@/services/auth/session-state': { authDataNamespace: () => 'guest' },
    '@/hooks/use-auth': { useAuth: () => ({ user: null }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true }) },
    '@/hooks/use-meal-store': { todayId: () => '2026-11-10' },
    '@/services/storage': { storage: { getItem: async () => null, setItem: async () => {}, isDurableItem: () => true } },
    '@/services/sync/sync-client': { collectionStorageKey: () => 'weights', syncClient: {
      invalidateCollectionCheckpoint: async () => {}, reportLocalPersistenceError() {},
      registerCollection: () => () => {}, enqueue: async () => {},
    } },
    '@/services/sync/types': local('./src/services/sync/types.ts'),
    '@/services/weight/weight': local('./src/services/weight/weight.ts'),
  });
  const DayPage = React.memo(function DayPage({ dateId }) {
    renders[dateId]++;
    const w = weightMod.useWeightForDate(dateId);
    return React.createElement('WeightCell', { dateId, grams: w?.weightGrams ?? null });
  });
  function Controller() {
    save = weightMod.useWeightStore().saveWeight;
    return null;
  }
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(
      React.createElement(weightMod.WeightProvider, null,
        React.createElement(Controller),
        React.createElement(DayPage, { dateId: '2026-11-07' }),
        React.createElement(DayPage, { dateId: '2026-11-08' }),
        React.createElement(DayPage, { dateId: '2026-11-09' })
      )
    );
  });
  const baseline = { ...renders };
  await renderer.act(async () => {
    assert.equal(save('2026-11-08', 72400), true);
  });
  assert.equal(renders['2026-11-07'], baseline['2026-11-07'], 'neighbour 2026-11-07 does not re-render');
  assert.equal(renders['2026-11-09'], baseline['2026-11-09'], 'neighbour 2026-11-09 does not re-render');
  assert.equal(renders['2026-11-08'], baseline['2026-11-08'] + 1, 'only the modified date 2026-11-08 re-renders');
  await renderer.act(async () => tree.unmount());
});

test('production-compiled NativeDayWindow prepares pages on selected without idle and preserves visible Day across rebase', async () => {
  const raf = global.requestAnimationFrame, cancel = global.cancelAnimationFrame;
  const frames = new Map(), js = [];
  let nextFrame = 0;
  global.requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id; };
  global.cancelAnimationFrame = id => frames.delete(id);
  const PagerHost = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ setPageWithoutAnimation() {} }), []);
    return React.createElement('NativePager', props, props.children);
  });
  const { NativeDayWindow, NATIVE_WINDOW_RADIUS: C } = compile('src/components/meal/native-day-window.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 400 }) },
    'react-native-pager-view': { __esModule: true, default: PagerHost },
    'react-native-reanimated': {
      __esModule: true,
      default: { createAnimatedComponent: () => PagerHost },
      useSharedValue: initial => React.useRef({ value: initial }).current,
      useEvent: handler => handler,
      runOnUI: fn => (...args) => fn(...args),
      runOnJS: fn => (...args) => js.push(() => fn(...args)),
    },
    '../../lib/dates': dates,
    '../../dev/native-pager-status': local('./src/dev/native-pager-status.ts'),
  });
  const nav = navigation.createLogNavigation('2026-11-07');
  const position = { value: dates.dateIdToEpochDay(nav.get()) }, interaction = { value: 0 };
  const renderDay = dateId => React.createElement('CompiledDay', { dateId });
  function Host() {
    const date = React.useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    return React.createElement(NativeDayWindow, {
      dateId: date, revision: nav.getRevision(), readRevision: nav.getRevision,
      position, interaction, renderDay,
      onSettle: (next, expected) => { if (expected !== nav.getRevision()) return; nav.set(next); return nav.getRevision(); },
    });
  }
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); });
    const p = tree.root.findByType('NativePager');
    assert.deepEqual(tree.root.findAllByType('CompiledDay').map(d => d.props.dateId), ['2026-11-06', '2026-11-07', '2026-11-08']);
    await renderer.act(async () => {
      p.props.onPageSelected({ nativeEvent: { position: C } });
      p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'dragging' } });
      p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'settling' } });
      p.props.onPageSelected({ nativeEvent: { position: C + 1 } });
      p.props.onPageSelected({ nativeEvent: { position: C + 2 } });
    });
    const mounted = tree.root.findAllByType('CompiledDay').map(d => d.props.dateId);
    assert.ok(mounted.includes('2026-11-09') && mounted.includes('2026-11-11'), 'compiled component prepares target ± 2 before idle');
    assert.equal(nav.get(), '2026-11-07');
    await renderer.act(async () => {
      p.props.onPageSelected({ nativeEvent: { position: C + 26 } });
    });
    const edgeBefore = tree.root.findAllByType('CompiledDay').find(d => d.props.dateId === '2026-12-03');
    assert.ok(edgeBefore, 'edge day is prepared on selected');
    await renderer.act(async () => {
      p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'idle' } });
      for (const fn of js.splice(0)) fn();
    });
    assert.equal(nav.get(), '2026-12-03');
    const edgeAfter = tree.root.findAllByType('CompiledDay').find(d => d.props.dateId === '2026-12-03');
    assert.equal(edgeAfter, edgeBefore, 'compiled rebase keeps visible Day instance mounted');
  } finally {
    if (tree) await renderer.act(async () => tree.unmount());
    global.requestAnimationFrame = raf; global.cancelAnimationFrame = cancel;
  }
});

// The existing test:feed/CI entry must also execute the restored feed regressions.
require('./compact-diary.test.cjs');
require('./daily-calorie-target.test.cjs');
