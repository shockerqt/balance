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
    '@legendapp/list/reanimated': { AnimatedLegendList: props => React.createElement('List', props, props.data.map((item, index) => React.createElement(React.Fragment, { key: item.key }, props.renderItem({ item, index })))) },
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
    await h.size(700); assert.equal(h.list().props.contentContainerStyle[1].paddingBottom, 16);
    h.calls.length = 0; await h.release(60); assert.equal(h.calls.length, 0);
    assert.equal(h.list().props.sharedValues.scrollOffset, h.scrollOffset);
  } finally { await h.close(); }
});
test('short overflow gets full collapse travel, with midpoint snap in either direction', async () => {
  const h = await harness(); try {
    await h.size(850); assert.equal(h.list().props.contentContainerStyle[1].paddingBottom, 182);
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

test('macro mode shows monochrome totals for group and row, exposes TalkBack labels and preserves press', async () => {
  const Feed = load(), food = { id: 'a', name: 'Avena', portion: '100 g', time: '08:00', calories: 100, protein: 5, carbs: 10, fat: 2 };
  let tree, selected;
  const props = { foods: [food], empty: React.createElement('Empty'), onAddAtHour() {}, onSelectFood: f => { selected = f; } };
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Feed, props)); });
    assert.ok(tree.root.findAllByType('Touch').every(n => !n.props.accessibilityLabel.includes('P 5')));
    await renderer.act(async () => tree.update(React.createElement(Feed, { ...props, showMacros: true })));
    const labels = tree.root.findAllByType('Touch').map(n => n.props.accessibilityLabel);
    assert.equal(labels.filter(v => v.includes('P 5 · C 10 · G 2')).length, 2);
    const macroTexts = tree.root.findAllByType('Text').filter(n => { const text = [n.props.children].flat().join(''); return text.includes('P 5 · C 10 · G 2') || text.includes('100 g · 5P · 10C · 2G'); });
    assert.equal(macroTexts.length, 2);
    const row = tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel.startsWith('Avena'));
    assert.equal(row.findAllByType('Text').length, 3, 'name, one combined detail, and calories'); assert.ok(macroTexts.every(n => n.props.tone === 'secondary' && !n.props.style?.color));
    await renderer.act(async () => tree.root.findAllByType('Touch').find(n => n.props.accessibilityLabel.startsWith('Avena')).props.onPress());
    assert.equal(selected.id, 'a');
  } finally { if (tree) await renderer.act(async () => tree.unmount()); }
});
function loadFile(relative, stubs) {
  const file = path.join(root, relative), m = new Module(file, module); m.filename = file;
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
test('Settings starts Simple, toggles canonical preferences, persists, rehydrates and accepts sync', async () => {
  let cache = null, callbacks; const pushed = [];
  const types = local('./src/services/sync/types.ts');
  const preferences = loadFile('src/hooks/use-preferences-store.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    '@/lib/day-targets': local('./src/lib/day-targets.ts'),
    '@/services/config': { API_BASE_URL: 'https://example.test/api' },
    '@/services/auth/session-state': { authDataNamespace: () => 'user' },
    '@/hooks/use-auth': { useAuth: () => ({ user: null }) },
    '@/services/storage': { storage: { getItem: async () => cache, setItem: async (_key, value) => { cache = value; }, isDurableItem: () => true } },
    '@/services/sync/types': types,
    '@/services/sync/sync-client': { collectionStorageKey: () => 'prefs', syncClient: {
      invalidateCollectionCheckpoint: async () => {}, reportLocalPersistenceError() {},
      registerCollection: (_name, handlers) => { callbacks = handlers; return () => {}; },
      setCollectionEnabled() {}, enqueue: async (...args) => { pushed.push(args); },
    } },
  });
  const settings = loadFile('src/app/settings.tsx', {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': Object.fromEntries(['Alert','Modal','Pressable','ScrollView','Switch','TouchableOpacity','View'].map(n => [n, host(n)])),
    'expo-router': { Stack: { Screen: host('StackScreen') }, useRouter: () => ({}) },
    '@/components/ui': Object.fromEntries(['Button','Icon','Input','Screen','Text'].map(n => [n, host(n)])),
    '@/hooks/use-auth': { useAuth: () => ({ isGuest: true }) },
    '@/dev/react-native-spike-gate': { reactNativeSpikeEnabled: false },
    '@/hooks/use-preferences-store': preferences,
    '@/theme': { makeStyles: () => () => ({}), useTheme: () => ({ colors: {}, space: {} }), useThemeControls: () => ({ preference: { appearance: 'system' }, ready: true }) },
    '@/components/updates/update-information': { UpdateInformation: host('Updates') },
  }).default;
  let tree;
  const mount = async () => { await renderer.act(async () => { tree = renderer.create(React.createElement(preferences.PreferencesProvider, null, React.createElement(settings))); }); };
  const toggle = () => tree.root.findAllByType('Switch').find(n => n.props.accessibilityLabel === 'Mostrar macros en el diario');
  try {
    await mount(); assert.equal(toggle().props.value, false); assert.equal(toggle().props.disabled, false);
    assert.ok(tree.root.findAllByType('Text').some(n => n.props.children === 'Simple'));
    await renderer.act(async () => toggle().props.onValueChange(true));
    assert.equal(toggle().props.value, true); assert.equal(JSON.parse(cache)[0].preferences.diaryMacrosEnabled, true);
    assert.equal(pushed.at(-1)[0], 'userPreferences'); assert.equal(pushed.at(-1)[1].preferences.diaryMacrosEnabled, true);
    await renderer.act(async () => tree.unmount()); await mount(); assert.equal(toggle().props.value, true);
    await renderer.act(async () => callbacks.onDocuments([{ id: 'guest', preferences: { diaryMacrosEnabled: false }, updatedAt: Date.now() + 100, _deleted: false }]));
    assert.equal(toggle().props.value, false);
  } finally { if (tree) await renderer.act(async () => tree.unmount()); }
});


test('real base clearance keeps near-fitting rows static; runway size notifications do not compound', async () => {
  const h = await harness();
  try {
    const padding=h.list().props.contentContainerStyle[1];
    await h.size(padding.paddingTop+396+padding.paddingBottom);
    assert.equal(h.list().props.scrollEnabled,false,'396px of rows fit with the approved header and clearance');
    h.calls.length=0; await h.release(60); assert.equal(h.calls.length,0);
    await h.size(850);
    assert.equal(h.list().props.contentContainerStyle[1].paddingBottom,182);
    await h.size(1016); // native reports base850 + added166 runway
    assert.equal(h.list().props.contentContainerStyle[1].paddingBottom,182,'runway never adds itself twice');
    await h.size(650); // content shrinks while old166 runway still exists
    assert.equal(h.list().props.contentContainerStyle[1].paddingBottom,16);
    await h.size(484); // native reports the same content after removing runway
    assert.equal(h.list().props.scrollEnabled,false);
    await h.size(1300); assert.equal(h.list().props.contentContainerStyle[1].paddingBottom,16);
    h.calls.length=0;
    await renderer.act(async()=>h.list().props.onScrollEndDrag({nativeEvent:{contentOffset:{y:150},velocity:{y:2}}}));
    assert.equal(h.calls.length,0,'a fling waits for momentum to finish');
    await h.release(150); assert.deepEqual(h.calls,[{offset:216,animated:true}]);
  } finally { await h.close(); }
});
