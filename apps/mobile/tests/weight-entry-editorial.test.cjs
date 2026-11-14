const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), ts = local('typescript');
const geometry = local('./src/lib/weight-sheet-layout.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
const NativeView = React.forwardRef((props, ref) => React.createElement('View', { ...props, ref }, props.children));
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
function emitter() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return { remove: () => listeners.get(name).delete(fn) }; },
    emit(name, event) { for (const fn of [...(listeners.get(name) ?? [])]) fn(event); },
    count() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
  };
}
async function harness(options = {}) {
  let date = options.date ?? '2026-11-12', enabled = options.enabled !== false, focused = true, today = '2026-11-12';
  const saves = [], deletes = [], alerts = [], measurements = [], preferences = [], scrolls = [];
  let backs = 0, measurementCount = 0, autoMeasure = !options.deferMeasures;
  let bounds = { y: options.originY ?? 0, height: options.dimensions?.height ?? 844, width: 400 };
  let weights = options.weights ?? { '2026-11-11': { id: '2026-11-11', weightGrams: 78000 } };
  const keyboardEvents = emitter(), dimensions = emitter(), appEvents = emitter();
  let metrics = options.metrics;
  const Keyboard = { metrics: () => { options.onMetrics?.(keyboardEvents); return metrics; }, dismiss() {},
    addListener: keyboardEvents.addEventListener.bind(keyboardEvents) };
  const AppState = { currentState: 'active', addEventListener: appEvents.addEventListener.bind(appEvents) };
  const saveWeight = (...args) => { saves.push(args); return options.saveResult !== false; };
  const deleteWeight = id => deletes.push(id), router = { back: () => backs++ };
  const file = path.join(root, 'src/app/weight-entry.tsx'), m = new Module(file, module); m.filename = file;
  const stubs = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, View: NativeView, TouchableOpacity: host('Touch'), Pressable: host('Pressable'), ScrollView: host('ScrollView'),
      Platform: { OS: options.platform ?? 'android' }, Keyboard, AppState, Dimensions: dimensions,
      AccessibilityInfo: { prefersCrossFadeTransitions: () => new Promise((resolve, reject) => preferences.push({ resolve, reject })) },
      PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
    'expo-router': { useIsFocused: () => focused, useRouter: () => router, useLocalSearchParams: () => ({ dateId: date }) },
    '@/components/ui': Object.fromEntries(['Button','Icon','Input','Text'].map(n => [n, host(n)])),
    '@/hooks/use-meal-store': { todayId: () => today, displayDateFor: id => id },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: weights, saveWeight, deleteWeight }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ weightTrackingEnabled: enabled }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: options.top ?? 0, bottom: options.bottom ?? 0 }) },
    '@/lib/weight-sheet-layout': geometry, '@/lib/dates': local('./src/lib/dates.ts'),
    '@/theme': { font: local('./src/theme/tokens.ts').font, makeStyles: build => () => build(local('./src/theme/palettes.ts').makeBalanceTheme(options.scheme ?? 'light')) },
    '@/services/weight/weight': local('./src/services/weight/weight.ts'), '@/services/sync/types': local('./src/services/sync/types.ts') };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const Screen = m.exports.default; let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen), { createNodeMock: element => element.props.testID === 'weight-sheet-root' ? {
    measureInWindow(callback) { measurementCount++; if (autoMeasure) callback(0, bounds.y, bounds.width, bounds.height); else measurements.push(callback); },
  } : element.props.testID === 'weight-sheet-body' ? { scrollTo: value => scrolls.push(value), scrollToEnd: value => scrolls.push({ ...value, end: true }) } : null }); });
  const node = id => tree.root.findAllByType('View').find(n => n.props.testID === id);
  const layout = async (id, height) => renderer.act(async () => node(id).props.onLayout({ nativeEvent: { layout: { height } } }));
  const readout = () => tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel?.startsWith('Peso '));
  const h = { tree, saves, deletes, alerts, measurements, preferences, scrolls, Keyboard,
    node, readout, layout, backs: () => backs, count: () => measurementCount,
    overlap: () => flat(node('weight-sheet-avoidance').props.style).paddingBottom,
    cap: () => flat(tree.root.findByType('ScrollView').props.style).maxHeight,
    input: () => tree.root.findByType('Input'),
    async press(title) { await renderer.act(async () => (tree.root.findAllByType('Button').find(n => n.props.title === title) ?? tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel === title)).props.onPress()); },
    async open() { await renderer.act(async () => readout().props.onPress()); },
    async hydrate(next) { weights = next; await renderer.act(async () => tree.update(React.createElement(Screen))); },
    async change(next) { if ('date' in next) date = next.date; if ('enabled' in next) enabled = next.enabled; if ('focused' in next) focused = next.focused; if ('today' in next) today = next.today; await renderer.act(async () => tree.update(React.createElement(Screen))); },
    async event(name, screenY = 500) { metrics = name.endsWith('Hide') ? undefined : { screenY, screenX: 0, width: 400, height: 300 }; await renderer.act(async () => keyboardEvents.emit(name, { endCoordinates: metrics ?? { screenY: 844 } })); },
    defer() { autoMeasure = false; },
    async measure(next = {}) { bounds = { ...bounds, ...next }; await renderer.act(async () => node('weight-sheet-root').props.onLayout()); },
    async resolve(index, next = {}) { const value = { ...bounds, ...next }; await renderer.act(async () => measurements[index](0, value.y, value.width, value.height)); },
    async preference(index, value, reject = false) { await renderer.act(async () => reject ? preferences[index].reject(Error('unavailable')) : preferences[index].resolve(value)); },
    listeners: () => keyboardEvents.count() + dimensions.count() + appEvents.count(),
    async dimensions() { await renderer.act(async () => dimensions.emit('change', {})); },
    async app(state) { AppState.currentState = state; await renderer.act(async () => appEvents.emit('change', state)); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
  if (options.layout !== false) { await layout('weight-sheet-viewport', options.usable ?? 800); await layout('weight-sheet-footer', options.footer ?? 86); }
  if (options.edit !== false && enabled && date <= today && !options.deferMeasures) await h.open();
  return h;
}
test('editorial steppers use exact 100g, signed prior-day delta and canonical save', async () => {
  const h = await harness(); try {
    assert.equal(h.input().props.value, '78,0'); await h.press('+0,1'); assert.equal(h.input().props.value, '78,1');
    assert.ok(h.tree.root.findAllByType('Text').some(n => String(n.props.children).includes('+0,1 kg vs. ayer (78,0 kg)')));
    await h.press('Guardar peso'); assert.deepEqual(h.saves, [['2026-11-12',78100]]); assert.equal(h.backs(), 1);
  } finally { await h.close(); }
});
test('direct decimal rejects excess precision and hydration preserves dirty input', async () => {
  const h = await harness(); try {
    await renderer.act(async () => h.input().props.onChangeText('72,45')); await h.press('Guardar peso'); assert.equal(h.saves.length,0);
    await renderer.act(async () => h.input().props.onChangeText('72,4'));
    await h.hydrate({ '2026-11-12': { id: '2026-11-12', weightGrams: 80000 } }); assert.equal(h.input().props.value,'72,4');
    await h.press('Guardar peso'); assert.equal(h.saves[0][1],72400);
  } finally { await h.close(); }
});
test('ruler and adjustable actions advance exactly 100g; deletion confirms', async () => {
  const h = await harness({ weights: { '2026-11-12': { id:'2026-11-12',weightGrams:78000 } } }); try {
    const ruler = () => h.tree.root.findAllByType('View').find(n => n.props.accessibilityRole === 'adjustable');
    await renderer.act(async () => { ruler().props.onPanResponderGrant({ nativeEvent:{pageX:100} }); ruler().props.onPanResponderMove({ nativeEvent:{pageX:90} }); });
    assert.equal(h.input().props.value,'78,1');
    await renderer.act(async () => ruler().props.onAccessibilityAction({ nativeEvent:{actionName:'decrement'} })); assert.equal(h.input().props.value,'78,0');
    await h.press('Eliminar'); assert.equal(h.deletes.length,0);
    await renderer.act(async () => h.alerts[0][2].find(b=>b.text==='Eliminar').onPress()); assert.deepEqual(h.deletes,['2026-11-12']);
  } finally { await h.close(); }
});
test('future and disabled tracking disable entry and save', async () => {
  for (const options of [{ date:'2026-11-13' },{ enabled:false }]) {
    const h = await harness(options); try {
      assert.equal(h.tree.root.findAllByType('Input').length,0);
      assert.equal(h.tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel?.startsWith('Peso ')).props.disabled,true);
      assert.equal(h.tree.root.findAllByType('Button').find(n=>n.props.title==='Guardar peso').props.disabled,true);
    } finally { await h.close(); }
  }
});

test('readout opens decimal entry, preserves invalid text, normalizes valid blur and cancels without save', async () => {
  const h = await harness({ edit:false }); try {
    assert.equal(h.tree.root.findAllByType('Input').length,0);
    const readout=()=>h.tree.root.findAllByType('Touch').find(n=>n.props.accessibilityLabel?.startsWith('Peso '));
    assert.equal(readout().findAllByType('Text')[0].props.style.fontSize,48);
    await renderer.act(async()=>readout().props.onPress());
    assert.equal(h.input().props.autoFocus,true);
    await renderer.act(async()=>h.input().props.onChangeText('72,45'));
    await renderer.act(async()=>h.input().props.onBlur());
    assert.equal(h.input().props.value,'72,45'); assert.equal(h.saves.length,0);
    assert.ok(h.tree.root.findAllByType('Text').some(n=>n.props.accessibilityRole==='alert'));
    await renderer.act(async()=>h.input().props.onChangeText('72.4'));
    await renderer.act(async()=>h.input().props.onBlur());
    assert.equal(h.tree.root.findAllByType('Input').length,0);
    assert.equal(readout().props.accessibilityLabel,'Peso 72,4 kg, tocar para escribir');
    await h.press('Cancelar'); assert.equal(h.backs(),1); assert.equal(h.saves.length,0);
  } finally { await h.close(); }
});
test('ruler moves fractional scale under a fixed needle and respects both limits', async () => {
  for (const grams of [1000,78000,500000]) {
    const h=await harness({ weights:{ '2026-11-12':{id:'2026-11-12',weightGrams:grams} } }); try {
      const view=id=>h.tree.root.findAllByType('View').find(n=>n.props.testID===id);
      const needle=JSON.stringify(view('weight-ruler-needle').props.style);
      await h.press('+0,1');
      assert.equal(h.input().props.value,grams===500000?'500,0':grams===1000?'1,1':'78,1');
      assert.equal(view('weight-ruler-track').props.style[1].transform[0].translateX,grams===500000?0:-10);
      assert.equal(JSON.stringify(view('weight-ruler-needle').props.style),needle);
      await h.press('−1,0');
      if(grams===1000) assert.equal(h.input().props.value,'1,0');
    } finally { await h.close(); }
  }
});
test('intrinsic editorial surface uses actual viewport and one flow footer, without detents or KAV', async () => {
  const h = await harness({ edit: false, usable: 480, footer: 100, top: 24, bottom: 34, scheme: 'dark' });
  try {
    assert.equal(h.cap(), 380);
    const footer = h.node('weight-sheet-footer');
    assert.equal(flat(footer.props.style).paddingBottom, 34);
    assert.ok(footer.findAllByType('Button').some(n => n.props.title === 'Guardar peso'));
    assert.equal(h.tree.root.findByType('ScrollView').findAllByType('Button').some(n => n.props.title === 'Guardar peso'), false);
    assert.equal(flat(h.node('weight-sheet-surface').props.style).backgroundColor, '#1A1C20');
    assert.equal(h.tree.root.findAllByType('KeyboardAvoidingView').length, 0);
    const count = h.count(); await h.press('+0,1'); assert.equal(h.count(), count); assert.equal(h.cap(), 380);
  } finally { await h.close(); }
});

test('geometry helper uses current window intersection, not keyboard height or a detent', () => {
  assert.deepEqual(geometry.weightSheetOverlap({ y: 24, height: 776 }, { screenY: 500 }), { overlap: 300, ready: true });
  assert.equal(geometry.weightSheetOverlap({ y: 24, height: 476 }, { screenY: 500 }).overlap, 0);
  assert.equal(geometry.weightSheetOverlap({ y: 0, height: 100 }, { screenY: -20 }).overlap, 100);
  assert.deepEqual(geometry.weightSheetOverlap(null, null), { overlap: 0, ready: false });
  assert.equal(geometry.weightSheetOverlap({ y: NaN, height: 10 }, { screenY: 5 }).ready, false);
  assert.equal(geometry.weightSheetOverlap({ y: 0, height: 100 }, { screenY: NaN }).ready, false);
  assert.equal(geometry.weightSheetOverlap({ y: 0, height: 100 }, { screenY: 0 }, null).ready, false);
  assert.equal(geometry.weightSheetOverlap({ y: 0, height: 100 }, { screenY: 0 }, true).overlap, 0);
  assert.equal(geometry.weightSheetBodyCap(null, 80), undefined);
  assert.equal(geometry.weightSheetBodyCap(500, NaN), undefined);
  assert.equal(geometry.weightSheetBodyCap(400, 86), 314);
  assert.equal(geometry.weightSheetBodyCap(80, 100), 0);
});

test('bootstrap keeps an intrinsic surface and blocks editing until useful measurements exist', async () => {
  const h = await harness({ edit: false, layout: false, deferMeasures: true });
  try {
    assert.equal(h.cap(), undefined);
    assert.equal(flat(h.node('weight-sheet-surface').props.style).maxHeight, '100%');
    assert.equal(h.readout().props.disabled, true);
    await h.layout('weight-sheet-viewport', 500); await h.layout('weight-sheet-footer', 86);
    assert.equal(h.readout().props.disabled, true);
    await h.resolve(h.measurements.length - 1, { y: 24, height: 776 });
    assert.equal(h.readout().props.disabled, false);
    await h.layout('weight-sheet-footer', 600);
    assert.equal(h.readout().props.disabled, true, 'a zero body is not accepted as ready');
  } finally { await h.close(); }
});

test('late origin and both native resize/event orders converge without a third keyboard event', async () => {
  for (const resizeFirst of [false, true]) {
    const h = await harness({ edit: false, originY: 24, dimensions: { height: 776 } });
    try {
      if (resizeFirst) await h.measure({ height: 476 });
      await h.event('keyboardDidShow', 500);
      assert.equal(h.overlap(), resizeFirst ? 0 : 300);
      await h.measure({ height: 476 }); assert.equal(h.overlap(), 0);
      await h.measure({ y: 40, height: 476 }); assert.equal(h.overlap(), 16, 'same height/new origin recalculates');
      await h.event('keyboardDidHide'); assert.equal(h.overlap(), 0);
      await h.layout('weight-sheet-viewport', 420); assert.equal(h.cap(), 334, 'cap does not subtract keyboard again');
    } finally { await h.close(); }
  }
});

test('current keyboard beats delayed origin and inverted or pre-hide measurement callbacks', async () => {
  const h = await harness({ edit: false, deferMeasures: true });
  try {
    const old = h.measurements.length - 1;
    await h.event('keyboardDidShow', 500); const show = h.measurements.length - 1;
    await h.resolve(show, { y: 24, height: 776 }); assert.equal(h.overlap(), 300);
    await h.resolve(old, { y: 0, height: 900 }); assert.equal(h.overlap(), 300);
    await h.event('keyboardDidHide'); const hide = h.measurements.length - 1;
    assert.equal(h.overlap(), 0, 'hide is immediate, before measure');
    await h.resolve(show, { y: 100, height: 900 }); assert.equal(h.overlap(), 0);
    await h.resolve(hide, { y: 24, height: 776 }); assert.equal(h.overlap(), 0);
    await h.event('keyboardDidShow', 600); const latest = h.measurements.length - 1;
    await h.resolve(latest, { y: 24, height: 776 }); assert.equal(h.overlap(), 200);
    await h.resolve(hide, { y: 0, height: 1000 }); assert.equal(h.overlap(), 200);
  } finally { await h.close(); }
});

test('metrics bootstrap supports visible keyboard and an event during the snapshot takes precedence', async () => {
  for (const eventDuringMetrics of [false, true]) {
    const h = await harness({ edit: false, originY: 24, dimensions: { height: 776 }, metrics: { screenY: 500 },
      onMetrics: eventDuringMetrics ? events => events.emit('keyboardDidHide', {}) : undefined });
    try { assert.equal(h.overlap(), eventDuringMetrics ? 0 : 300); }
    finally { await h.close(); }
  }
  const h = await harness({ edit: false });
  try { assert.equal(h.overlap(), 0); assert.equal(h.readout().props.disabled, false); }
  finally { await h.close(); }
});

test('fresh measure precedes edit and pending intent cannot outlive date/preference/focus', async () => {
  for (const change of [{ date: '2026-11-10' }, { enabled: false }, { focused: false }]) {
    const h = await harness({ edit: false });
    try {
      h.defer(); await h.open(); const pending = h.measurements.length - 1;
      assert.equal(h.tree.root.findAllByType('Input').length, 0);
      await h.change(change); await h.resolve(pending, { y: 24, height: 776 });
      assert.equal(h.tree.root.findAllByType('Input').length, 0);
    } finally { await h.close(); }
  }
  const h = await harness({ edit: false });
  try {
    h.defer(); await h.open(); const pending = h.measurements.length - 1;
    await h.resolve(pending, { y: 24, height: 776 });
    assert.equal(h.input().props.autoFocus, true);
  } finally { await h.close(); }
});

test('measurement and preference work is rejected after blur/unmount and a new focus session', async () => {
  const h = await harness({ edit: false });
  h.defer(); await h.event('keyboardDidShow', 500); const old = h.measurements.length - 1;
  const retainedPadding = h.overlap();
  await h.change({ focused: false }); await h.resolve(old, { y: 30, height: 900 });
  assert.equal(h.overlap(), retainedPadding, 'blurred layout is not changed by an old measure');
  await h.change({ focused: true }); const current = h.measurements.length - 1;
  await h.resolve(current, { y: 0, height: 700 }); assert.equal(h.overlap(), 200);
  await h.resolve(old, { y: 30, height: 900 }); assert.equal(h.overlap(), 200);
  const callback = h.measurements[current]; await h.close();
  await renderer.act(async () => callback(0, 0, 400, 1000));
  assert.equal(h.listeners(), 0);
});

test('iOS zero-frame preference never resurrects show after hide and remains episode scoped', async () => {
  const h = await harness({ edit: false, platform: 'ios' });
  try {
    await h.event('keyboardWillChangeFrame', 0);
    assert.equal(h.readout().props.disabled, true); assert.equal(h.overlap(), 0);
    await h.event('keyboardWillHide'); assert.equal(h.overlap(), 0);
    await h.preference(0, false); assert.equal(h.overlap(), 0);
    await h.event('keyboardDidShow', 0); assert.equal(h.overlap(), 0, 'late didShow does not undo willHide');
    await h.event('keyboardDidHide');
    await h.event('keyboardWillChangeFrame', 0); const fresh = h.preferences.length - 1;
    await h.preference(fresh, true); assert.equal(h.overlap(), 0); assert.equal(h.readout().props.disabled, false);
    await h.event('keyboardWillChangeFrame', 500); assert.equal(h.overlap(), 344);
    await h.preference(fresh, false); assert.equal(h.overlap(), 344);
  } finally { await h.close(); }
});

test('iOS zero-frame false/rejected preferences and changed measurement tickets fail safely', async () => {
  const h = await harness({ edit: false, platform: 'ios' });
  try {
    await h.event('keyboardWillChangeFrame', 0); const old = h.preferences.length - 1;
    await h.measure({ y: 24, height: 776 }); const next = h.preferences.length - 1;
    await h.preference(old, false); assert.equal(h.overlap(), 0);
    await h.preference(next, false); assert.equal(h.overlap(), 776);
    await h.event('keyboardWillHide'); assert.equal(h.overlap(), 0);
    await h.event('keyboardWillChangeFrame', 0); const failure = h.preferences.length - 1;
    await h.preference(failure, false, true);
    assert.equal(h.readout().props.disabled, true); assert.equal(h.overlap(), 0);
    const count = h.preferences.length; await h.layout('weight-sheet-footer', 100);
    assert.equal(h.preferences.length, count, 'failed preference does not retry on content layout');
    await h.event('keyboardWillHide'); assert.equal(h.overlap(), 0);
  } finally { await h.close(); }
});

test('retained flow actions read current draft but reject revoked or terminal authority', async () => {
  const h = await harness();
  try {
    const retained = h.tree.root.findAllByType('Button').find(n => n.props.title === 'Guardar peso').props.onPress;
    await renderer.act(async () => h.input().props.onChangeText('72,4'));
    await renderer.act(async () => { retained(); retained(); });
    assert.deepEqual(h.saves, [['2026-11-12', 72400]]); assert.equal(h.backs(), 1);
  } finally { await h.close(); }
  for (const change of [{ enabled: false }, { date: '2026-11-10' }, { date: '2026-11-13' }, { focused: false }, { today: '2026-11-11' }]) {
    const h = await harness();
    try {
      const retained = h.tree.root.findAllByType('Button').find(n => n.props.title === 'Guardar peso').props.onPress;
      await h.change(change); await renderer.act(async () => retained());
      assert.equal(h.saves.length, 0); assert.equal(h.backs(), 0);
    } finally { await h.close(); }
  }
});

test('stale confirmation, canceled surface and unmounted actions cannot write or navigate', async () => {
  for (const change of [{ date: '2026-11-10' }, { enabled: false }, { focused: false }]) {
    const h = await harness({ weights: { '2026-11-12': { id: '2026-11-12', weightGrams: 78000 } } });
    try {
      await h.press('Eliminar'); const confirm = h.alerts[0][2][1].onPress;
      await h.change(change); await renderer.act(async () => confirm());
      assert.deepEqual(h.deletes, []); assert.equal(h.backs(), 0);
    } finally { await h.close(); }
  }
  for (const close of ['backdrop', 'unmount']) {
    const h = await harness(); const save = h.tree.root.findAllByType('Button').find(n => n.props.title === 'Guardar peso').props.onPress;
    if (close === 'backdrop') await renderer.act(async () => h.tree.root.findByType('Pressable').props.onPress());
    else await h.close();
    await renderer.act(async () => save()); assert.equal(h.saves.length, 0); assert.equal(h.backs(), close === 'backdrop' ? 1 : 0);
    if (close !== 'unmount') await h.close();
  }
});

test('failed canonical save stays open and permits a corrected attempt', async () => {
  const h = await harness({ saveResult: false });
  try {
    await h.press('Guardar peso'); await h.press('Guardar peso');
    assert.equal(h.saves.length, 2); assert.equal(h.backs(), 0);
    assert.ok(h.tree.root.findAllByType('Text').some(n => n.props.accessibilityRole === 'alert'));
  } finally { await h.close(); }
});

test('root Stack configures only weight-entry as transparentModal before route mount', async () => {
  const file = path.join(root, 'src/app/_layout.tsx'), m = new Module(file, module); m.filename = file;
  const pass = props => React.createElement(React.Fragment, null, props.children);
  const Stack = Object.assign(host('Stack'), { Screen: host('StackScreen') });
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': { Platform: { OS: 'android' }, View: NativeView },
    'expo-router/stack': { Stack }, 'expo-router': { ThemeProvider: pass, DarkTheme: {}, DefaultTheme: {} },
    'expo-status-bar': { StatusBar: host('StatusBar') }, 'react-native-gesture-handler': { GestureHandlerRootView: pass },
    '@/theme': { ThemeProvider: pass, font: {}, useTheme: () => local('./src/theme/palettes.ts').makeBalanceTheme('light') },
  };
  for (const [moduleName, exported] of [['use-meal-store','MealStoreProvider'],['use-food-library-store','FoodLibraryProvider'],['use-auth','AuthProvider'],['use-preferences-store','PreferencesProvider'],['use-weight-store','WeightProvider']]) stubs['@/hooks/' + moduleName] = { [exported]: pass };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, file);
  let tree; await renderer.act(async () => { tree = renderer.create(React.createElement(m.exports.default)); });
  try {
    const screens = tree.root.findAllByType('StackScreen');
    const options = screens.find(n => n.props.name === 'weight-entry').props.options;
    assert.deepEqual(options, { presentation: 'transparentModal', animation: 'fade', gestureEnabled: false, headerShown: false, contentStyle: { backgroundColor: 'transparent' } });
    assert.deepEqual(screens.find(n => n.props.name === 'food-edit').props.options.sheetAllowedDetents, [0.6, 0.95]);
  } finally { await renderer.act(async () => tree.unmount()); }
});

test('current editor/error is revealed after the body cap changes without moving the footer', async () => {
  const h = await harness();
  try {
    assert.ok(h.scrolls.some(value => value.y === 0));
    await h.layout('weight-sheet-viewport', 350);
    assert.equal(h.cap(), 264);
    await renderer.act(async () => h.input().props.onChangeText('72,45'));
    await h.press('Guardar peso');
    assert.ok(h.scrolls.some(value => value.end));
    assert.equal(h.node('weight-sheet-footer').findAllByType('Button')[0].props.title, 'Guardar peso');
  } finally { await h.close(); }
});

test('foreground metrics cannot overwrite a hide event observed while the snapshot is read', async () => {
  const h = await harness({ edit: false, metrics: { screenY: 500 }, onMetrics: events => events.emit('keyboardDidHide', {}) });
  try { await h.app('background'); await h.app('active'); assert.equal(h.overlap(), 0); }
  finally { await h.close(); }
});

test('deferred cross-fade response after unmount has no remaining route authority', async () => {
  const h = await harness({ edit: false, platform: 'ios' });
  await h.event('keyboardWillChangeFrame', 0); assert.equal(h.preferences.length, 1);
  await h.close(); await h.preference(0, false); assert.equal(h.listeners(), 0);
});
