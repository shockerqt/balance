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
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, View: host('View'), TouchableOpacity: host('Touch'), PanResponder: { create: handlers => ({ panHandlers: handlers }) } },
    'expo-router': { useRouter: () => ({ back: () => backs++ }), useLocalSearchParams: () => ({ dateId: date }) },
    '@/components/ui': Object.fromEntries(['Button','Field','Input','Sheet','Text'].map(n => [n, host(n)])),
    '@/hooks/use-meal-store': { todayId: () => '2026-11-12', displayDateFor: id => id },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: weights, saveWeight: (...args) => { saves.push(args); return true; }, deleteWeight: id => deletes.push(id) }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ weightTrackingEnabled: options.enabled !== false }) },
    '@/theme': { makeStyles: () => () => ({}) }, '@/services/weight/weight': local('./src/services/weight/weight.ts'), '@/services/sync/types': local('./src/services/sync/types.ts') };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const Screen = m.exports.default; let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  return { tree, saves, deletes, alerts, backs: () => backs,
    input: () => tree.root.findByType('Input'),
    async press(title) { await renderer.act(async () => tree.root.findAllByType('Button').find(n => n.props.title === title).props.onPress()); },
    async hydrate(next) { weights = next; await renderer.act(async () => tree.update(React.createElement(Screen))); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}
test('editorial steppers use exact 100g, signed prior-day delta and canonical save', async () => {
  const h = await harness(); try {
    assert.equal(h.input().props.value, '78,0'); await h.press('+0,1'); assert.equal(h.input().props.value, '78,1');
    assert.ok(h.tree.root.findAllByType('Text').some(n => String(n.props.children).includes('+0,1 kg vs. 2026-11-11')));
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
      assert.equal(h.input().props.editable,false);
      assert.equal(h.tree.root.findAllByType('Button').find(n=>n.props.title==='Guardar peso').props.disabled,true);
    } finally { await h.close(); }
  }
});
