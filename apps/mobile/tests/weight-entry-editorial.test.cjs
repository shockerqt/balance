const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), ts = local('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
async function harness(options = {}) {
  const date = options.date ?? '2026-11-12', saves = [], deletes = [], alerts = []; let backs = 0;
  let weights = options.weights ?? { '2026-11-11': { id: '2026-11-11', weightGrams: 78000 } };
  const file = path.join(root, 'src/app/weight-entry.tsx'), m = new Module(file, module); m.filename = file;
  const stubs = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, View: host('View'), TouchableOpacity: host('Touch'), KeyboardAvoidingView: host('KeyboardAvoidingView'), ScrollView: host('ScrollView'), Platform: { OS: 'android' }, useWindowDimensions: () => ({ height: 844, width: 400, fontScale: 1, ...options.dimensions }), PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
    'expo-router': { Stack: { Screen: host('StackScreen') }, useRouter: () => ({ back: () => backs++ }), useLocalSearchParams: () => ({ dateId: date }) },
    '@/components/ui': Object.fromEntries(['Button','Icon','Input','Text'].map(n => [n, host(n)])),
    '@/hooks/use-meal-store': { todayId: () => '2026-11-12', displayDateFor: id => id },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: weights, saveWeight: (...args) => { saves.push(args); return true; }, deleteWeight: id => deletes.push(id) }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ weightTrackingEnabled: options.enabled !== false }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: options.bottom ?? 0 }) },
    '@/lib/dates': local('./src/lib/dates.ts'),
    '@/theme': { font: local('./src/theme/tokens.ts').font, makeStyles: build => () => build(local('./src/theme/palettes.ts').makeBalanceTheme(options.scheme ?? 'light')) }, '@/services/weight/weight': local('./src/services/weight/weight.ts'), '@/services/sync/types': local('./src/services/sync/types.ts') };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const Screen = m.exports.default; let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  if (options.edit !== false && options.enabled !== false && date <= '2026-11-12') await renderer.act(async () => tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel?.startsWith('Peso ')).props.onPress());
  return { tree, saves, deletes, alerts, backs: () => backs,
    input: () => tree.root.findByType('Input'),
    async press(title) { await renderer.act(async () => (tree.root.findAllByType('Button').find(n => n.props.title === title) ?? tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel === title)).props.onPress()); },
    async hydrate(next) { weights = next; await renderer.act(async () => tree.update(React.createElement(Screen))); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
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
test('short screen and large text expand sheet with a scrollable body and safe fixed footer', async () => {
  const h=await harness({edit:false,dimensions:{height:568,fontScale:2},bottom:34,scheme:'dark'}); try {
    const options=h.tree.root.findByType('StackScreen').props.options;
    assert.deepEqual(options.sheetAllowedDetents,[0.9,0.95]); assert.equal(options.sheetGrabberVisible,false);
    assert.equal(options.sheetCornerRadius,28);
    const body=h.tree.root.findByType('ScrollView'); assert.equal(body.props.style.flex,1);
    const footer=h.tree.root.findAllByType('View').find(n=>Array.isArray(n.props.style)&&n.props.style[1]?.paddingBottom===34);
    assert.ok(footer.findAllByType('Button').some(n=>n.props.title==='Guardar peso'));
    assert.equal(body.findAllByType('Button').filter(n=>n.props.title==='Guardar peso').length,0);
    assert.equal(h.tree.root.findByType('KeyboardAvoidingView').props.style.backgroundColor,'#1A1C20');
  } finally { await h.close(); }
});
