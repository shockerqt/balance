const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), ts = local('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
async function harness() {
  const focus = new Set(), foods = [], weights = [], ticks = [];
  const file = path.join(root, 'src/components/meal/quick-add-dock.tsx'), m = new Module(file, module); m.filename = file;
  const stubs = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { PanResponder: { create: handlers => ({ panHandlers: handlers }) }, View: host('View'), TouchableOpacity: host('Touch'), useWindowDimensions: () => ({ width: 400 }) },
    'expo-router': { useFocusEffect: fn => React.useEffect(() => { const cleanup = fn(); focus.add(cleanup); return () => { cleanup(); focus.delete(cleanup); }; }, [fn]) },
    '@/components/ui': { Icon: host('Icon'), Text: host('Text') },
    '@/theme': { font: local('./src/theme/tokens.ts').font, useTheme: () => local('./src/theme/palettes.ts').makeBalanceTheme('light') },
    '@/lib/hour-haptics': { tickHourChange: (previous, next) => { if (next !== null && next !== previous) ticks.push(next); } },
    '@/lib/quick-add-gesture': local('./src/lib/quick-add-gesture.ts') };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  const Dock = m.exports.QuickAddDock;
  let tree; let props = { contextKey: '2026-11-12:0', weightAvailable: true, onFood: t => foods.push(t), onWeight: () => weights.push(true), children: [1,2,3,4].map(i => React.createElement('Tab', { key: i })) };
  await renderer.act(async () => { tree = renderer.create(React.createElement(Dock, props), { createNodeMock: () => ({ measureInWindow: fn => fn(0, 0, 288, 288) }) }); });
  const plus = () => tree.root.findAllByType('View').find(n => n.props.onPanResponderGrant);
  const event = (x = 144, y = 400, id = 1, touches) => ({ nativeEvent: { identifier: id, pageX: x, pageY: y, touches: touches ?? [{ identifier: id, pageX: x, pageY: y }] } });
  const send = async (name, x, y, id, touches) => renderer.act(async () => plus().props[name](event(x,y,id,touches)));
  return { tree, plus, foods, weights, ticks,
    grant: () => send('onPanResponderGrant'), move: (x,y,id,touches) => send('onPanResponderMove',x,y,id,touches), release: (x,y) => send('onPanResponderRelease',x,y),
    async tap() { await send('onPanResponderGrant'); await send('onPanResponderRelease'); },
    async press(label) { await renderer.act(async () => tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel === label).props.onPress()); },
    async action(name) { await renderer.act(async () => plus().props.onAccessibilityAction({ nativeEvent: { actionName: name } })); },
    async measure() { await renderer.act(async () => tree.root.findAllByType('View').find(n => n.props.onLayout).props.onLayout()); },
    async update(next) { props = { ...props, ...next }; await renderer.act(async () => tree.update(React.createElement(Dock, props))); },
    async blur() { await renderer.act(async () => { for (const cleanup of focus) cleanup(); }); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}
test('tap morphs dock at same plus axis; menu buttons register now or weight', async () => {
  const h = await harness(); try {
    const original = h.plus().props.style;
    await h.tap(); assert.equal(h.ticks.length, 0); assert.equal(h.tree.root.findAllByType('Tab').length, 0);
    assert.deepEqual({ ...h.plus().props.style, backgroundColor: original.backgroundColor }, original);
    assert.equal(h.plus().props.style.backgroundColor, '#ECEDE9');
    await h.press('Ahora'); assert.deepEqual(h.foods, [undefined]);
    await h.tap(); await h.press('Peso'); assert.equal(h.weights.length, 1);
  } finally { await h.close(); }
});
test('continuous left/right and up-to-radial release work without lifting', async () => {
  const h = await harness(); try {
    await h.grant(); await h.move(80,400); await h.release(80,400); assert.equal(h.weights.length, 1);
    await h.grant(); await h.move(210,400); await h.release(210,400); assert.equal(h.foods.length, 1);
    await h.grant(); await h.move(144,360); await h.measure();
    const angle = 126 * Math.PI / 180, x = 144 + 112 * Math.cos(angle), y = 144 + 112 * Math.sin(angle) + 24;
    await h.move(x,y); await h.release(x,y); assert.equal(h.foods.at(-1), '05:00');
  } finally { await h.close(); }
});
test('350ms hold and TalkBack offer all 19 hours; date change/blur cancel pending input', async () => {
  const h = await harness(); try {
    await h.grant(); await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 365)); });
    assert.equal(h.tree.root.findAllByType('Touch').filter(n => n.props.accessibilityLabel?.startsWith('Registrar a las')).length, 19);
    await h.press('Cancelar elección de hora'); await h.action('chooseHour'); await h.press('Registrar a las 23:00'); assert.equal(h.foods.at(-1), '23:00');
    await h.grant(); await h.update({ contextKey: '2026-11-13:0' }); await h.release(210,400); assert.equal(h.foods.length, 1);
    await h.grant(); await h.blur(); await h.release(210,400); assert.equal(h.foods.length, 1);
  } finally { await h.close(); }
});
test('disabled weight, second touch and termination never dispatch weight or food', async () => {
  const h = await harness(); try {
    await h.update({ weightAvailable: false }); await h.action('weight'); assert.equal(h.weights.length, 0);
    await h.grant(); await h.move(210,400,2,[{ identifier: 1, pageX: 210, pageY: 400 }, { identifier: 2, pageX: 210, pageY: 400 }]); await h.release(210,400);
    assert.equal(h.foods.length, 0);
    await h.grant(); await renderer.act(async () => h.plus().props.onPanResponderTerminate()); await h.release(210,400); assert.equal(h.foods.length, 0);
  } finally { await h.close(); }
});

test('hours tick once on highlight change and delayed hour choices cannot tick or navigate after cancel', async () => {
  const h = await harness(); try {
    await h.grant(); await h.move(144,360); await h.measure();
    const point = hour => { const a = (126 + (hour-5)*16)*Math.PI/180; return [144+112*Math.cos(a),144+112*Math.sin(a)+24]; };
    const p5 = point(5), p6 = point(6);
    await h.move(...p5); await h.move(...p5); await h.move(...p6); await h.release(...p6);
    assert.deepEqual(h.ticks,[5,6]); assert.deepEqual(h.foods,['06:00']);
    await h.action('chooseHour');
    const queued = h.tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel === 'Registrar a las 23:00').props.onPress;
    await h.press('Cancelar elección de hora'); await h.action('chooseHour');
    await renderer.act(async () => queued());
    assert.deepEqual(h.ticks,[5,6]); assert.deepEqual(h.foods,['06:00']);
    await h.press('Registrar a las 23:00'); assert.deepEqual(h.ticks,[5,6,23]);
  } finally { await h.close(); }
});


test('reference dock keeps its hit box while moving the ink puck and anchors an outlined radial hub', async () => {
  const h = await harness();
  try {
    const box = { ...h.plus().props.style };
    await h.grant(); await h.move(210,400);
    const puck = h.plus().findAllByType('View').find(n => n.props.pointerEvents === 'none' && n.props.style.width === 52);
    assert.equal(puck.props.style.height,44); assert.notEqual(puck.props.style.transform[0].translateX,0);
    assert.equal(h.plus().props.style.width,box.width); assert.equal(h.plus().props.style.height,box.height);
    await h.release(210,400); await h.action('chooseHour');
    const dial=h.tree.root.findAllByType('View').find(n=>n.props.accessibilityLabel==='Elegir hora');
    assert.equal(dial.props.style.bottom+144,193);
    assert.equal(h.tree.root.findAllByType('View').filter(n=>n.props.testID==='hour-horseshoe').length,1);
    const hub=h.tree.root.findAllByType('Touch').find(n=>n.props.accessibilityLabel==='Cancelar elección de hora');
    assert.equal(hub.props.style.width,132); assert.equal(hub.props.style.height,132);
    assert.equal(hub.props.style.backgroundColor,'#FFFFFF');
    const first=h.tree.root.findAllByType('Touch').find(n=>n.props.accessibilityLabel==='Registrar a las 05:00');
    assert.equal(first.findByType('Text').props.children,'05');
  } finally { await h.close(); }
});
