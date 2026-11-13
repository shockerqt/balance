const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
function load(reduced = false) {
  const file = path.join(root, 'src/components/meal/meal-group-feed.tsx');
  const m = new Module(file, module); m.filename = file;
  const stubs = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { TouchableOpacity: host('Touch'), View: host('View') },
    '@legendapp/list/reanimated': { AnimatedLegendList: host('List') },
    'react-native-reanimated': { useReducedMotion: () => reduced },
    '@/lib/meal-groups': local('./src/lib/meal-groups.ts'),
    '@/lib/nutrition': local('./src/lib/nutrition.ts'),
    '@/theme': { makeStyles: () => () => ({}) },
    '@/components/ui': { Icon: host('Icon'), Text: host('Text') } };
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports.MealGroupFeed;
}
async function harness(reduced = false) {
  let tree; const scrollOffset = { value: 0 }, calls = [];
  await renderer.act(async () => { tree = renderer.create(React.createElement(load(reduced), {
    foods: [], empty: React.createElement('Empty'), scrollOffset, onAddAtHour() {}, onSelectFood() {},
  })); });
  const list = () => tree.root.findByType('List');
  list().props.ref({ scrollToOffset: options => calls.push(options) });
  return { tree, list, calls, scrollOffset, async size(height) {
    await renderer.act(async () => list().props.onLayout({ nativeEvent: { layout: { height: 800 } } }));
    await renderer.act(async () => list().props.onContentSizeChange(400, height));
  }, async release(offset) {
    await renderer.act(async () => list().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: offset } } }));
  }, async close() { await renderer.act(async () => tree.unmount()); } };
}
test('fitting day reserves no runway and does not snap', async () => {
  const h = await harness(); try {
    await h.size(700); assert.equal(h.list().props.contentContainerStyle[1].paddingBottom, 120);
    h.calls.length = 0; await h.release(60); assert.equal(h.calls.length, 0);
    assert.equal(h.list().props.sharedValues.scrollOffset, h.scrollOffset);
  } finally { await h.close(); }
});
test('short overflow gets full collapse travel, with midpoint snap in either direction', async () => {
  const h = await harness(); try {
    await h.size(850); assert.equal(h.list().props.contentContainerStyle[1].paddingBottom, 286);
    await h.release(107); await h.release(108); await h.release(300);
    assert.deepEqual(h.calls, [{ offset: 0, animated: true }, { offset: 216, animated: true }]);
  } finally { await h.close(); }
});
test('reduced motion settles snap immediately', async () => {
  const h = await harness(true); try {
    await h.size(1200); await h.release(150);
    assert.deepEqual(h.calls, [{ offset: 216, animated: false }]);
  } finally { await h.close(); }
});
test('legacy preferences accept missing macros; malformed macros reject document', () => {
  const { isUserPreferencesDoc } = local('./src/services/sync/types.ts');
  const doc = { id: 'guest', preferences: {}, updatedAt: 1, _deleted: false };
  assert.equal(isUserPreferencesDoc(doc), true);
  assert.equal(isUserPreferencesDoc({ ...doc, preferences: { diaryMacrosEnabled: true } }), true);
  assert.equal(isUserPreferencesDoc({ ...doc, preferences: { diaryMacrosEnabled: 'true' } }), false);
});
