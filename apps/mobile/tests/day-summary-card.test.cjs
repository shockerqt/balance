const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
const colors = { surface: '#fff', border: '#eee', danger: '#b00', primary: '#111', macroProtein: '#00f', macroCarbs: '#a70', macroFat: '#c36' };
function load() {
  const file = path.join(root, 'src/components/meal/sticky-macro-header.tsx');
  const m = new Module(file, module); m.filename = file;
  const stubs = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': { StyleSheet: { create: x => x }, TouchableOpacity: host('Touch'), View: host('View') },
    '@/hooks/use-meal-store': {}, '@/components/ui': { ProgressBar: host('Bar'), Text: host('Text') }, '@/theme': { useTheme: () => ({ colors }) },
    '@/lib/nutrition': local('./src/lib/nutrition.ts') };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports.StickyMacroHeader;
}
const Card = load();
const food = (calories, protein = 10) => ({ id: String(calories), name: 'x', portion: '1g', time: '08:00', calories, protein, carbs: 20, fat: 5 });
const texts = tree => tree.root.findAllByType('Text').map(n => [n.props.children].flat().join(''));

test('shows calories against the day target and what is left', async () => {
  let tree, pressed = 0;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Card, { foods: [food(1000), food(340, 30)], targetCalories: 2000, onPress: () => pressed++ })); });
  const t = texts(tree);
  assert.ok(t.includes('1.340')); assert.ok(t.includes('de 2.000 kcal')); assert.ok(t.includes('660')); assert.ok(t.includes('te quedan'));
  const bars = tree.root.findAllByType('Bar');
  assert.equal(bars.length, 4); assert.equal(bars[0].props.over, false); assert.equal(bars[1].props.value, 40 / 150);
  await renderer.act(async () => tree.root.findByType('Touch').props.onPress()); assert.equal(pressed, 1);
});

test('over target switches to the over label and danger meter, and without onPress the card is inert', async () => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Card, { foods: [food(2500)], targetCalories: 2200 })); });
  const t = texts(tree);
  assert.ok(t.includes('300')); assert.ok(t.includes('sobre la meta'));
  assert.equal(tree.root.findAllByType('Bar')[0].props.over, true);
  assert.equal(tree.root.findByType('Touch').props.disabled, true);
});
