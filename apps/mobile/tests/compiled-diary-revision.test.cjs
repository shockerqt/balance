const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), babel = local('@babel/core'), ts = local('typescript');
const dates = local('./src/lib/dates.ts'), navigation = local('./src/lib/log-navigation.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
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
    '@/lib/diary-presentation': local('./src/lib/diary-presentation.ts'),
    '@/dev/native-pager-status': local('./src/dev/native-pager-status.ts'),
    './date-strip-header': { DateStripHeader: props => React.createElement('Header', { date: props.selectedDateId, week: dates.getMondayDateId(props.selectedDateId) }) },
    './sticky-macro-header': { StickyMacroHeader: host('Summary') },
    './native-day-window': { NativeDayWindow: props => React.createElement('Pager', props,
      (renderDays === 'window' ? Array.from({ length: 15 }, (_, i) => dates.shiftDateId('2026-11-08', i - 7)) : [props.dateId])
        .map(day => React.cloneElement(props.renderDay(day), { key: day }))) },
    './meal-group-feed': { MealGroupFeed: props => { React.useImperativeHandle(props.ref, () => ({ resetScroll: () => resets.push(true) })); return React.createElement('Feed', props); } },
  };
  const { ReactNativeDiary } = compile('src/components/meal/react-native-diary.tsx', stubs);
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(React.Profiler, { id: 'diary', onRender: () => commits++ }, React.createElement(ReactNativeDiary, { today: '2026-11-08' }))); });
  return { tree, shared, pushes, resets, food, commits: () => commits,
    async frame(offset) { await renderer.act(async () => {
      tree.root.findAllByType('Feed').find(n => n.props.dayNumber === dates.dateIdToEpochDay(hooks.logsDateStore.get())).props.scrollOffset.value = offset;
      for (let pass = 0; pass < 2; pass++) for (const r of [...reactions]) {
        const next = r.prepare();
        if (JSON.stringify(next) !== JSON.stringify(r.previous)) { const previous = r.previous; r.previous = next; r.react(next, previous); }
      }
    }); }, nav: hooks.logsDateStore, pager: () => tree.root.findByType('Pager').props,
    header: () => tree.root.findAllByType('Header').find(n => n.props.date === hooks.logsDateStore.get()).props,
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

test('compiled complete page compositions keep at most three headers and do not reset source on canonical acknowledgement', async () => {
  const h = await harness('window');
  try {
    const feed = day => h.tree.root.findAllByType('Feed').find(n => n.props.dayNumber === dates.dateIdToEpochDay(day));
    assert.equal(h.tree.root.findAllByType('Feed').length, 15, 'feed mount ownership remains unchanged');
    assert.equal(h.tree.root.findAllByType('Header').length, 3);
    await h.frame(216);
    const source = feed('2026-11-08');
    h.pager().position.value = dates.dateIdToEpochDay('2026-11-08') + .5;
    assert.equal(source.props.scrollOffset.value, 216);
    assert.equal(feed('2026-11-09').props.scrollOffset.value, 0);
    await h.swipe('2026-11-09');
    assert.equal(h.tree.root.findAllByType('Header').length, 3);
    assert.equal(feed('2026-11-08').props.scrollOffset.value, 216,
      'canonical JS acknowledgement does not reset a page; the actual native offscreen cleanup owns that');
    const before = h.pushes.length;
    await renderer.act(async () => source.props.onSelectFood(h.food));
    assert.equal(h.pushes.length, before, 'old visible/action callback cannot edit the confirmed destination');
    await renderer.act(async () => feed('2026-11-09').props.onSelectFood(h.food));
    assert.equal(h.pushes.at(-1).params.dateId, '2026-11-09');
    assert.equal(h.resets.length, 0);
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

test('compiled local diary keeps 1/3 geometry, omits weight, edits food and creates a new day at zero without a reset command', async () => {
  const h = await harness(true);
  try {
    assert.equal(h.tree.root.findAllByType('DailyWeightRow').length, 0);
    const header = h.tree.root.findAllByType('AnimatedView')[0];
    const summary = h.tree.root.findAllByType('AnimatedView')[1];
    const expanded = header.props.style[1].read().height + summary.props.style[1].read().height;
    const feed = h.tree.root.findByType('Feed');
    feed.props.scrollOffset.value = 216;
    const compact = header.props.style[1].read().height + summary.props.style[1].read().height;
    assert.equal(expanded, 324); assert.equal(compact, 108); assert.ok(compact <= expanded / 3);
    await renderer.act(async () => feed.props.onSelectFood(h.food));
    assert.deepEqual(h.pushes.pop(), { pathname: '/food-edit', params: { dateId: '2026-11-08', foodId: 'food-1' } });
    await h.swipe('2026-11-09'); await h.swipe('2026-11-08');
    assert.equal(h.tree.root.findByType('Feed').props.scrollOffset.value, 0);
    assert.equal(h.resets.length, 0, 'canonical acknowledgement does not command a visible reset');
  } finally { await h.close(); }
});

// Existing test:feed and CI explicitly execute this entry. Keep the composed
// installed-core/event contract suite registered without editing npm or CI.
require('./diary-presentation.test.cjs');

test('compiled diary retains one summary action and continuous frames do not commit React', async () => {
  const h = await harness(true);
  try {
    await h.frame(10); await h.frame(20);
    const commits = h.commits();
    for (const offset of [30, 40, 50, 60]) await h.frame(offset);
    assert.equal(h.commits(), commits, 'continuous scroll within a mode must stay on UI thread');
    const expanded = h.tree.root.findAllByType('Summary').find(n => !n.props.compact);
    assert.equal(h.tree.root.findAllByType('Summary').length, 1);
    await renderer.act(async () => expanded.props.onPress());
    assert.equal(h.pushes.at(-1).params.dateId, '2026-11-08');
    await h.frame(0);
    assert.equal(h.tree.root.findAllByType('Summary').length, 1);
  } finally { await h.close(); }
});
