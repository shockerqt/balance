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
async function harness() {
  const hooks = compile('src/hooks/use-logs-date.ts', {
    react: React, '@/lib/dates': { ...dates, todayId: () => '2026-11-08' }, '@/lib/log-navigation': navigation,
    '@/dev/log-performance': { beginLogNavigation() {}, installLogPerformance() {} },
  });
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), Alert: { alert() {} } },
    'expo-router': {}, 'expo-router/react-navigation': { useIsFocused: () => true },
    'react-native-reanimated': { useSharedValue: initial => React.useRef({ value: initial }).current },
    '@/components/ui': { Button: host('Button'), Card: host('Card'), Text: host('Text') },
    '@/components/weight/daily-weight-row': {}, '@/hooks/use-meal-store': {}, '@/hooks/use-preferences-store': {},
    '@/hooks/use-weight-store': {}, '@/hooks/use-food-selection': {}, '@/hooks/use-logs-date': hooks, '@/lib/dates': dates,
    './date-strip-header': { DateStripHeader: props => React.createElement('Header', { date: props.selectedDateId, week: dates.getMondayDateId(props.selectedDateId) }) },
    './sticky-macro-header': {}, './native-day-window': { NativeDayWindow: host('Pager') }, './meal-group-feed': {},
  };
  const { ReactNativeDiary } = compile('src/components/meal/react-native-diary.tsx', stubs);
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(ReactNativeDiary, { today: '2026-11-08' })); });
  return { tree, nav: hooks.logsDateStore, pager: () => tree.root.findByType('Pager').props, header: () => tree.root.findByType('Header').props,
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
