const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const contract = local('./src/components/meal/native/interface-contract.ts');
const daily = local('./src/components/meal/native/daily-log-contract.ts');
const copy = local('./src/components/meal/native/copy-selection-contract.ts');
const dates = local('./src/lib/dates.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-30';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const meal = () => ({ id: uuid(1), templateId: null, nameSnapshot: 'Original histórico',
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 3, carbs: 20, fat: 0, fiber: null } },
  canonicalQuantity: 50, entry: { enteredQuantity: 50 }, consumedAt: dates.epochForChileDateTime(date, '08:15'), updatedAt: 1000, _deleted: false });

async function harness({ enabled = true, commit = async () => {} } = {}) {
  let user = { id: 1 }, focus, blur, view, selectedDate = date, revision = 4;
  const subscribers = new Set(), writes = [], selections = [], pushes = [];
  let meals = {
    dayLogs: { [date]: { dateId: date, targetCalories: 2200, targetProtein: 160, targetCarbs: 220, targetFat: 70, targetFiber: 30,
      foods: [{ id: uuid(1), name: 'Original histórico', portion: '50g', time: '08:15', calories: 50, protein: 1.5, carbs: 10, fat: 0 }] } },
    mealDocuments: [meal()],
    registerMealLogs: async documents => { writes.push(documents); await commit(documents); },
  };
  const filename = path.join(root, 'src/components/meal/native/native-daily-log-screen.tsx');
  const stub = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'expo-crypto': { randomUUID: crypto.randomUUID },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useRouter: () => ({ push: args => pushes.push(args) }), useFocusEffect(cb) { React.useEffect(() => { focus = cb; blur = cb(); return () => blur?.(); }, [cb]); } },
    '../../../../modules/balance-daily-log': { BalanceDailyLogView: props => React.createElement('native-shell', props) },
    '@/components/ui': { Screen: props => React.createElement(React.Fragment, null, props.children) },
    '@/hooks/use-auth': { useAuth: () => ({ user, isGuest: false }) },
    '@/hooks/use-meal-store': { useMealStore: () => meals, emptyDayLog: id => ({ ...meals.dayLogs[date], dateId: id, foods: [] }) },
    '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: {}, syncError: null }) },
    '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true, syncError: null }) },
    '@/hooks/use-logs-date': { useLogsSelectedDate: () => [selectedDate], logsDateStore: {
      get: () => selectedDate, getRevision: () => revision, subscribe: fn => { subscribers.add(fn); return () => subscribers.delete(fn); },
      set: value => selections.push(value),
    } },
    '@/theme': { useTheme: () => ({ colors: {} }) }, '@/lib/dates': { ...dates, todayId: () => date },
    './daily-log-contract': daily, './interface-contract': contract, './copy-selection-contract': copy,
  };
  const moduleUnderTest = new Module(filename, module);
  moduleUnderTest.filename = filename;
  moduleUnderTest.require = name => { if (name in stub) return stub[name]; throw Error('Unexpected dependency ' + name); };
  moduleUnderTest._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, filename);
  const Screen = moduleUnderTest.exports.default;
  const tree = () => React.createElement(Screen, { copyEnabled: enabled });
  await renderer.act(async () => { view = renderer.create(tree()); });
  const props = () => view.root.findByType('native-shell').props;
  function event(p, sequence = 1, operationId = uuid(900), extra = {}) {
    return { nativeEvent: { session: JSON.parse(p.data).session, commandRevision: revision, sequence, date, action: 'copy',
      ids: [uuid(1)], time: '14:25', input: { operationId, destinationDate: '2026-11-01', revisions: { [uuid(1)]: 1000 } }, ...extra } };
  }
  return { writes, selections, pushes, props, event,
    async dispatch(value, p = props()) { await renderer.act(async () => { await p.onAction(value); }); },
    async begin(value, p = props()) { let pending; await renderer.act(async () => { pending = p.onAction(value); await tick(); }); return { pending }; },
    async settle(gate, pending) { await renderer.act(async () => { gate.resolve(); await pending; }); },
    async blur() { await renderer.act(async () => blur()); },
    async refocus() { await renderer.act(async () => { blur = focus(); }); },
    async account(id) { user = { id }; await renderer.act(async () => view.update(tree())); },
    async changeSource() { meals = { ...meals, mealDocuments: [{ ...meal(), updatedAt: 1001 }] }; await renderer.act(async () => view.update(tree())); },
    async navigate(value) { selectedDate = value; revision++; for (const fn of subscribers) fn(); await renderer.act(async () => view.update(tree())); },
    async close() { await renderer.act(async () => view.unmount()); },
  };
}

test('copy remains disabled until its compatible delivery gate is explicitly enabled', async () => {
  const h = await harness({ enabled: false });
  try {
    await h.dispatch(h.event(h.props()));
    assert.equal(h.writes.length, 0);
    assert.deepEqual(JSON.parse(h.props().copyStatus), {});
  } finally { await h.close(); }
});

test('real host waits for local receipt, ignores duplicate confirmations and stays on the source date', async () => {
  const gate = deferred(), h = await harness({ commit: () => gate.promise });
  try {
    const initial = h.props(), payload = initial.data;
    const first = await h.begin(h.event(initial));
    assert.equal(h.writes.length, 1);
    assert.equal(JSON.parse(h.props().copyStatus).state, 'saving');
    assert.equal(h.props().data, payload, 'copy progress must not serialize the complete history again');
    await h.dispatch(h.event(h.props(), 2));
    assert.equal(h.writes.length, 1);
    await h.settle(gate, first.pending);
    assert.equal(JSON.parse(h.props().copyStatus).state, 'success');
    await h.dispatch(h.event(h.props(), 3));
    assert.equal(h.writes.length, 1, 'replayed operation does not invent another set of IDs');
    assert.deepEqual(h.selections, []);
    assert.deepEqual(h.pushes, []);
    await h.dispatch(h.event(h.props(), 4, uuid(901)));
    assert.equal(h.writes.length, 2, 'a new intentional copy remains possible');
    assert.notEqual(h.writes[0][0].id, h.writes[1][0].id);
  } finally { gate.resolve(); await h.close(); }
});

test('local failure retains the same prepared IDs for retry, with no reconstructed snapshot', async () => {
  let attempts = 0;
  const h = await harness({ commit: async () => { if (!attempts++) throw Error('synthetic disk failure'); } });
  try {
    await h.dispatch(h.event(h.props()));
    assert.equal(JSON.parse(h.props().copyStatus).state, 'error');
    await h.dispatch(h.event(h.props(), 2));
    assert.equal(JSON.parse(h.props().copyStatus).state, 'success');
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[0], h.writes[1], 'retry reuses the full plan, IDs and timestamps');
    assert.deepEqual(h.writes[1][0].nutritionSnapshot, meal().nutritionSnapshot);
  } finally { await h.close(); }
});

test('stale same-account callbacks validate the latest source revision before preparing writes', async () => {
  const h = await harness();
  try {
    const old = h.props(), stale = h.event(old);
    await h.changeSource();
    await h.dispatch(stale, old);
    assert.equal(h.writes.length, 0);
    assert.match(JSON.parse(h.props().copyStatus).error, /cambiaron/);
  } finally { await h.close(); }
});

for (const boundary of ['blur', 'account', 'date']) test(`a receipt crossing ${boundary} cannot publish success into the replacement context`, async () => {
  const gate = deferred(), h = await harness({ commit: () => gate.promise });
  try {
    const old = h.props(), first = await h.begin(h.event(old));
    if (boundary === 'blur') { await h.blur(); await h.refocus(); }
    if (boundary === 'account') await h.account(2);
    if (boundary === 'date') await h.navigate('2026-10-29');
    await h.settle(gate, first.pending);
    assert.notEqual(JSON.parse(h.props().copyStatus).state, 'success');
    await h.dispatch(h.event(old, 2), old);
    assert.equal(h.writes.length, 1);
  } finally { gate.resolve(); await h.close(); }
});
