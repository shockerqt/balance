const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const dates = local('./src/lib/dates.ts');
const { createFoodEntry } = local('./src/components/meal/native/food-entry-contract.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const date = '2026-10-18';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const template = { id: uuid(2), name: 'Avena', isOfficial: false, updatedAt: 10, _deleted: false,
  details: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 380, protein: 13, carbs: 64, fat: 7, fiber: null, extendedNutrition: { calciumMg: 34.21 } }, portions: [{ id: 'cup', name: 'taza', portionQuantity: 1, canonicalQuantity: 80 }] } };
const source = () => createFoodEntry({ date, time: '08:15', quantity: '1.5', templateId: template.id, templateRevision: 10, portionId: 'cup' }, [template], uuid(1), 1000);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const host = name => props => React.createElement(name, props, props.children);

async function harness(screen, { commit = async () => {}, params = {}, documents = [source()] } = {}) {
  let view, user = { id: 1 }, guard, guardHandler;
  const focusEntries = new Map(), alerts = [];
  let meals = { mealDocuments: documents }, templates = [template];
  const writes = [], selections = [], backs = [], removals = [];
  const actions = { registerMealLogs: async docs => { writes.push(docs); await commit(docs); } };
  meals = { ...meals, ...actions, deleteFood: (...args) => removals.push(args) };
  const navigation = { dispatch: action => backs.push(action) };
  const router = { back: () => backs.push('back') };
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'expo-router': { useRouter: () => router, useNavigation: () => navigation, useLocalSearchParams: () => ({ dateId: date, ids: uuid(1), foodId: uuid(1), time: '08:15', ...params }),
      useFocusEffect(cb) { React.useEffect(() => { const entry = { cb, cleanup: cb() }; focusEntries.set(cb, entry); return () => { entry.cleanup?.(); focusEntries.delete(cb); }; }, [cb]); } },
    'expo-router/react-navigation': { usePreventRemove(value, handler) { guard = value; guardHandler = handler; } },
    'expo-crypto': { randomUUID: crypto.randomUUID },
    'react-native': { View: host('View'), ScrollView: host('ScrollView'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
      Platform: { OS: 'android' }, Alert: { alert: (...args) => alerts.push(args) },
      FlatList: props => React.createElement('FlatList', props, props.data.map((item, index) => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index })))) },
    '@/components/ui': Object.fromEntries(['Button', 'Card', 'Field', 'Input', 'Screen', 'Sheet', 'Text'].map(name => [name, host(name)])),
    '@/hooks/use-auth': { useAuth: () => ({ user, isGuest: false }) },
    '@/hooks/use-meal-store': { useMealActions: () => actions, useMealStore: () => meals },
    './use-meal-store': { useMealActions: () => actions },
    '@/hooks/use-food-library-store': { useFoodLibraryStore: () => ({ templateDocuments: templates, isLibraryReady: true }) },
    '@/hooks/use-logs-date': { logsDateStore: { set: value => selections.push(value) } },
    '@/lib/dates': { ...dates, todayId: () => date, currentTimeString: () => '08:15' },
    './calendar-month': { CalendarMonth: host('CalendarMonth') },
  };
  const cache = new Map();
  stubs['@/components/ui'].Sheet = props => React.createElement('Sheet', props, props.children, props.footer);
  function load(relative) {
    const filename = path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const m = new Module(filename, module); m.filename = filename; cache.set(filename, m);
    m.require = name => {
      if (name in stubs) return stubs[name];
      if (name === '@/hooks/use-meal-receipt') return load('src/hooks/use-meal-receipt.ts');
      if (name === './choice-row') return load('src/components/meal/choice-row.tsx');
      if (name.startsWith('./')) return local(path.join(path.dirname(filename), name));
      return local(name);
    };
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
    return m.exports;
  }
  const Component = load(`src/components/meal/${screen}.tsx`).default;
  const tree = () => React.createElement(Component);
  await renderer.act(async () => { view = renderer.create(tree()); });
  const button = title => view.root.findAllByType('Button').find(node => node.props.title === title);
  const field = label => view.root.findAllByType('Input').find(node => node.props.accessibilityLabel === label);
  const click = async title => { assert.ok(button(title), `missing ${title}`); await renderer.act(async () => { await button(title).props.onPress(); }); };
  return { writes, backs, selections, removals, alerts, button, field,
    get guard() { return guard; },
    async fill(label, value) { assert.ok(field(label), `missing field ${label}`); await renderer.act(async () => { field(label).props.onChangeText(value); }); },
    click,
    async begin(title) { let pending; await renderer.act(async () => { pending = button(title).props.onPress(); await tick(); }); return pending ? { pending } : {}; },
    async settle(gate, pending) { await renderer.act(async () => { gate.resolve(); await pending; await tick(); }); },
    async reject(gate, pending) { await renderer.act(async () => { gate.reject(Error('disk unavailable')); await pending; }); },
    async blur() { await renderer.act(async () => { for (const entry of focusEntries.values()) entry.cleanup?.(); }); },
    async refocus() { await renderer.act(async () => { for (const entry of focusEntries.values()) entry.cleanup = entry.cb(); }); },
    async account(id) { user = { id }; await renderer.act(async () => { view.update(tree()); }); },
    async changeDocuments(next) { meals = { ...meals, mealDocuments: next }; await renderer.act(async () => { view.update(tree()); }); },
    async changeTemplates(next) { templates = next; await renderer.act(async () => { view.update(tree()); }); },
    async close() { await renderer.act(async () => view.unmount()); },
  };
}

test('RN library registration preserves portions and waits for a durable receipt; double presses write once', async () => {
  const gate = deferred(), h = await harness('react-native-food-entry-screen', { commit: () => gate.promise });
  try {
    await h.click('Avena'); await h.click('taza'); await h.fill('Cantidad consumida', '1,5');
    const { pending } = await h.begin('Registrar alimento');
    assert.equal(h.guard, true); assert.equal(h.writes.length, 1); assert.equal(h.backs.length, 0);
    assert.equal(h.writes[0][0].canonicalQuantity, 120); assert.equal(h.writes[0][0].entry.portionSnapshot.name, 'taza');
    assert.equal(h.writes[0][0].nutritionSnapshot.nutritionPer100.fiber, null);
    await h.click('Registrar alimento'); assert.equal(h.writes.length, 1);
    await h.settle(gate, pending); assert.deepEqual(h.selections, [date]); assert.equal(h.backs.length, 1); assert.equal(h.guard, false);
  } finally { await h.close(); }
});

test('RN registration retries the exact document after a failed local receipt', async () => {
  let fail = true;
  const h = await harness('react-native-food-entry-screen', { commit: async () => { if (fail) throw Error('disk'); } });
  try {
    await h.click('Avena'); await h.click('Registrar alimento'); assert.equal(h.backs.length, 0);
    fail = false; await h.click('Registrar alimento');
    assert.equal(h.writes.length, 2); assert.strictEqual(h.writes[0], h.writes[1]); assert.equal(h.backs.length, 1);
  } finally { await h.close(); }
});

test('RN late receipt cannot navigate while blurred and finishes only when that draft is focused', async () => {
  const gate = deferred(), h = await harness('react-native-food-entry-screen', { commit: () => gate.promise });
  try {
    await h.click('Avena'); const { pending } = await h.begin('Registrar alimento');
    await h.blur(); await h.settle(gate, pending); assert.equal(h.backs.length, 0); assert.deepEqual(h.selections, []);
    await h.refocus(); assert.equal(h.backs.length, 1); assert.deepEqual(h.selections, [date]);
  } finally { await h.close(); }
});

test('RN account replacement discards a draft and ignores its late save receipt', async () => {
  const gate = deferred(), h = await harness('react-native-food-entry-screen', { commit: () => gate.promise });
  try {
    await h.click('Avena'); const { pending } = await h.begin('Registrar alimento');
    await h.account(2); await h.settle(gate, pending);
    assert.equal(h.backs.length, 0); assert.deepEqual(h.selections, []); assert.ok(h.button('Avena'));
  } finally { await h.close(); }
});

test('RN stale library revision is rejected before writing', async () => {
  const h = await harness('react-native-food-entry-screen');
  try { await h.click('Avena'); await h.changeTemplates([{ ...template, updatedAt: 11 }]); await h.click('Registrar alimento'); assert.equal(h.writes.length, 0); }
  finally { await h.close(); }
});

test('RN custom form keeps unknowns, explicit zero, portion normalization and extended nutrients', async () => {
  const h = await harness('react-native-food-entry-screen');
  try {
    await h.click('Alimento personalizado'); await h.fill('Nombre del alimento', 'Café'); await h.click('Mililitros (ml)'); await h.fill('Cantidad consumida', '200');
    await h.click('Etiqueta por porción'); await h.fill('Tamaño de la porción de la etiqueta', '50');
    for (const [label, value] of [['Energía', '10'], ['Proteínas', '0'], ['Carbohidratos', '2'], ['Grasas', '0'], ['Sodio', '0']]) await h.fill(label, value);
    await h.click('Otros nutrientes'); await h.fill('Cafeína', '20'); await h.click('Registrar alimento');
    const doc = h.writes[0][0], n = doc.nutritionSnapshot.nutritionPer100;
    assert.equal(doc.canonicalQuantity, 200); assert.equal(doc.nutritionSnapshot.canonicalUnit, 'ml');
    assert.equal(n.calories, 20); assert.equal(n.fat, 0); assert.equal(n.sodiumMg, 0); assert.equal(n.fiber, undefined); assert.equal(n.extendedNutrition.caffeineMg, 40);
  } finally { await h.close(); }
});

test('RN copy preserves historical snapshots, IDs on retry, original date and rejects stale source revisions', async () => {
  let fail = true;
  const h = await harness('react-native-copy-screen', { commit: async () => { if (fail) throw Error('disk'); } });
  try {
    await h.fill('Fecha de destino', '2026-11-01'); await h.fill('Hora de destino', '14:25'); await h.click('Copiar registros');
    const doc = h.writes[0][0]; assert.notEqual(doc.id, uuid(1)); assert.deepEqual(doc.nutritionSnapshot, source().nutritionSnapshot);
    assert.deepEqual(doc.copySource, { id: uuid(1), updatedAt: 1000 }); assert.equal(h.backs.length, 0);
    fail = false; await h.click('Copiar registros'); assert.strictEqual(h.writes[0], h.writes[1]); assert.equal(h.backs.length, 1); assert.deepEqual(h.selections, []);
  } finally { await h.close(); }
  const stale = await harness('react-native-copy-screen');
  try { await stale.changeDocuments([{ ...source(), updatedAt: 1001 }]); await stale.click('Copiar registros'); assert.equal(stale.writes.length, 0); }
  finally { await stale.close(); }
});

test('RN editing uses historical portion conversions and cannot overwrite a changed source', async () => {
  const h = await harness('react-native-food-edit-screen');
  try {
    await h.fill('Cantidad del registro', '2'); await h.fill('Hora del registro', '19:15'); await h.click('Guardar cambios');
    const doc = h.writes[0][0]; assert.equal(doc.id, uuid(1)); assert.equal(doc.canonicalQuantity, 160); assert.deepEqual(doc.nutritionSnapshot, source().nutritionSnapshot);
    assert.equal(dates.chileDateParts(doc.consumedAt).hour, 19);
  } finally { await h.close(); }
  const stale = await harness('react-native-food-edit-screen');
  try { await stale.changeDocuments([{ ...source(), updatedAt: 1001 }]); await stale.click('Guardar cambios'); assert.equal(stale.writes.length, 0); }
  finally { await stale.close(); }
});

test('queued RN callbacks check current documents and delete confirmation cannot survive blur', async () => {
  const h = await harness('react-native-copy-screen');
  try {
    const queued = h.button('Copiar registros').props.onPress;
    await h.changeDocuments([{ ...source(), updatedAt: 1001 }]);
    await renderer.act(async () => { await queued(); });
    assert.equal(h.writes.length, 0);
  } finally { await h.close(); }
  const edit = await harness('react-native-food-edit-screen');
  try {
    await edit.click('Eliminar registro');
    const confirm = edit.alerts[0][2].find(button => button.text === 'Eliminar').onPress;
    await edit.blur(); await renderer.act(async () => { confirm(); });
    assert.equal(edit.removals.length, 0); assert.equal(edit.backs.length, 0);
  } finally { await edit.close(); }
});

test('RN move rejects nonexistent Chilean DST times and changed/deleted selections', async () => {
  const dst = await harness('react-native-move-screen', { params: { dateId: '2026-09-06' }, documents: [{ ...source(), consumedAt: dates.epochForChileDateTime('2026-09-06', '08:15') }] });
  try { await dst.fill('Nueva hora', '00:30'); await dst.click('Mover a las 00:30'); assert.equal(dst.writes.length, 0); }
  finally { await dst.close(); }
  const h = await harness('react-native-move-screen');
  try { await h.changeDocuments([{ ...source(), _deleted: true, updatedAt: 1001 }]); await h.click('Mover a las 13:00'); assert.equal(h.writes.length, 0); }
  finally { await h.close(); }
  const valid = await harness('react-native-move-screen');
  try { await valid.click('Mover a las 13:00'); assert.equal(valid.writes.length, 1); assert.equal(dates.chileDateParts(valid.writes[0][0].consumedAt).hour, 13); }
  finally { await valid.close(); }
});
