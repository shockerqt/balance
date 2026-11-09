const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), ts = local('typescript');
const { createLogNavigation } = local('./src/lib/log-navigation.ts');
const dates = local('./src/lib/dates.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
const date = '2026-10-18';
function compile(file, stubs) {
  const filename = path.join(root, file), m = new Module(filename, module); m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; throw Error('Unexpected dependency: ' + name); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
const colors = { primary: '#789', text: '#eee', surface: '#222', surfaceRaised: '#333' };

test('RN shell has four destinations, central registration uses the measurement date and summary opens its actual selected day', async () => {
  const nav = createLogNavigation(date), pushes = [], alerts = [], focusEntries = new Map();
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), ScrollView: host('ScrollView'), Switch: host('Switch'), TouchableOpacity: host('TouchableOpacity'), Alert: { alert: (...args) => alerts.push(args) } },
    'expo-router': { useRouter: () => ({ push: value => pushes.push(value) }), useFocusEffect(cb) { React.useEffect(() => { const entry = { cb, cleanup: cb() }; focusEntries.set(cb, entry); return () => { entry.cleanup?.(); focusEntries.delete(cb); }; }, [cb]); } },
    '@/components/ui': Object.fromEntries(['Screen','Button','Card','Icon','Text'].map(name => [name, host(name)])),
    '@/hooks/use-auth': { useAuth: () => ({ user: { id: 1, name: 'Cuenta' }, isGuest: false }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true }) },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: {}, syncError: null }) },
    '@/hooks/use-today-id': { useTodayId: () => date },
    '@/hooks/use-logs-date': { logsDateStore: nav, useLogsSelectedDate: () => [React.useSyncExternalStore(nav.subscribe, nav.get, nav.get)] },
    '@/lib/dates': { ...dates, todayId: () => date, currentTimeString: () => '13:00' },
    '@/theme': { useTheme: () => ({ colors, gradients: {} }) }, '@/theme/gradient': { gradientBackground: () => ({}) },
    '@/components/weight/weight-trend-card': { WeightTrendCard: host('Weight') },
    './calendar-month': { CalendarMonth: host('Calendar') }, './react-native-diary': { ReactNativeDiary: host('Diary') },
    './react-native-summary': { ReactNativeSummary: host('Summary') }, './page-header': { PageHeader: host('PageHeader') },
  };
  const Screen = compile('src/components/meal/react-native-interface-screen.tsx', stubs).default;
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  const press = async label => renderer.act(async () => { tree.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label).props.onPress(); });
  try {
    assert.equal(tree.root.findAllByType('TouchableOpacity').filter(node => node.props.accessibilityRole === 'tab').length, 4);
    assert.equal(tree.root.findAllByType('Diary').length, 1);
    await press('Mediciones'); await renderer.act(async () => tree.root.findByType('Calendar').props.onChange('2026-10-10'));
    await press('Registrar alimento o peso'); await renderer.act(async () => alerts.at(-1)[2].find(button => button.text === 'Peso').onPress());
    assert.deepEqual(pushes.at(-1), { pathname: '/weight-entry', params: { dateId: '2026-10-10' } });
    await press('Resumen'); await renderer.act(async () => tree.root.findByType('Summary').props.onOpen('2026-10-12', false));
    assert.equal(nav.get(), '2026-10-12'); assert.equal(tree.root.findAllByType('Diary').length, 1);
    await press('Resumen'); await renderer.act(async () => tree.root.findByType('Summary').props.onOpen('2026-10-09', true));
    assert.equal(nav.get(), '2026-10-09'); assert.equal(tree.root.findByType('Calendar').props.value, '2026-10-09');
    await press('Perfil'); const setting = tree.root.findAllByType('Button').find(node => node.props.title === 'Cuenta y configuración');
    await renderer.act(async () => setting.props.onPress()); assert.equal(pushes.at(-1), '/settings');
    await press('Registrar alimento o peso'); const queued = alerts.at(-1)[2].find(button => button.text === 'Alimento').onPress;
    await renderer.act(async () => { for (const entry of focusEntries.values()) entry.cleanup?.(); });
    const before = pushes.length; await renderer.act(async () => queued()); assert.equal(pushes.length, before);
  } finally { await renderer.act(async () => tree.unmount()); }
});

test('calendar jumps directly to another year without commanding intermediate dates and selects explicit Chilean date IDs', async () => {
  const selected = [];
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), TouchableOpacity: host('TouchableOpacity') },
    '@/components/ui': Object.fromEntries(['Button','Icon','Input','Text'].map(name => [name, host(name)])),
    '@/lib/dates': { ...dates, todayId: () => date }, '@/services/sync/types': local('./src/services/sync/types.ts'),
    '@/theme': { useTheme: () => ({ colors }) },
  };
  const { CalendarMonth } = compile('src/components/meal/calendar-month.tsx', stubs);
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(CalendarMonth, { value: date, onChange: value => selected.push(value), marked: { '2099-01-15': true } })); });
  const button = title => tree.root.findAllByType('Button').find(node => node.props.title === title);
  const touch = label => tree.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === label);
  try {
    await renderer.act(async () => touch('Cambiar mes o año').props.onPress());
    await renderer.act(async () => tree.root.findByType('Input').props.onChangeText('2099-01'));
    await renderer.act(async () => button('Ir al mes').props.onPress()); assert.deepEqual(selected, []);
    await renderer.act(async () => touch('2099-01-15, con registro').props.onPress()); assert.deepEqual(selected, ['2099-01-15']);
    await renderer.act(async () => button('Hoy').props.onPress()); assert.equal(selected.at(-1), date);
  } finally { await renderer.act(async () => tree.unmount()); }
});

test('the visible Chilean day refreshes at midnight and on foreground return, then releases its timer/listener', async () => {
  let current = date, interval, foreground, removed = false, cleared = false, observed;
  const originalSet = global.setInterval, originalClear = global.clearInterval;
  global.setInterval = (callback, ms) => { assert.equal(ms, 60000); interval = callback; return 123; };
  global.clearInterval = value => { assert.equal(value, 123); cleared = true; };
  const { useTodayId } = compile('src/hooks/use-today-id.ts', {
    react: React,
    'react-native': { AppState: { addEventListener: (_, cb) => { foreground = cb; return { remove() { removed = true; } }; } } },
    '@/lib/dates': { todayId: () => current },
  });
  function Host() { observed = useTodayId(); return null; }
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); }); assert.equal(observed, date);
    current = '2026-10-19'; await renderer.act(async () => interval()); assert.equal(observed, current);
    current = '2026-10-21'; await renderer.act(async () => foreground('active')); assert.equal(observed, current);
    await renderer.act(async () => tree.unmount()); assert.equal(removed, true); assert.equal(cleared, true);
  } finally { global.setInterval = originalSet; global.clearInterval = originalClear; if (tree) await renderer.act(async () => tree.unmount()); }
});
