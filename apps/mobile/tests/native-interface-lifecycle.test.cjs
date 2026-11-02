const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const contract = local('./src/components/meal/native/interface-contract.ts');
const daily = local('./src/components/meal/native/daily-log-contract.ts');
const dates = local('./src/lib/dates.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const date = '2026-10-18';
let user = { id: 'a', name: 'Cuenta A' }, focus, blur, updates = [], saves = [], pushes = [], selections = [];
const doc = { id: 'food', nameSnapshot: 'Histórico', nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 3, carbs: 20, fat: 1 } }, canonicalQuantity: 50, entry: { enteredQuantity: 1, portionSnapshot: { portionId: 'cup', name: 'taza', portionQuantity: 1, canonicalQuantity: 50 } }, consumedAt: dates.epochForChileDateTime(date, '08:15'), updatedAt: 10, _deleted: false };
const mealStore = {
  dayLogs: { [date]: { dateId: date, targetCalories: 2200, targetProtein: 160, targetCarbs: 220, targetFat: 70, targetFiber: 30, foods: [{ id: 'food', name: 'Histórico', portion: '1 taza', time: '08:15', calories: 50, protein: 1.5, carbs: 10, fat: .5 }] } }, mealDocuments: [doc],
  updateFood: (...args) => updates.push(args),
};
const router = { push: args => pushes.push(args) };
let theme = { colors: { background: '#141e1b', primary: '#c9e5ae' }, scheme: 'dark', gradients: { header: ['#213c34', '#413745'], action: ['#bddfa2', '#d6bbdf'] } };
const filename = path.join(root, 'src/components/meal/native/native-daily-log-screen.tsx');
const stub = {
  react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
  'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
  'expo-router': { useRouter: () => router, useFocusEffect(cb) { React.useEffect(() => { focus = cb; blur = cb(); return () => blur?.(); }, [cb]); } },
  '../../../../modules/balance-daily-log': { BalanceDailyLogView: props => React.createElement('native-shell', props) },
  '@/components/ui': { Screen: props => React.createElement(React.Fragment, null, props.children) },
  '@/hooks/use-auth': { useAuth: () => ({ user, isGuest: false }) },
  '@/hooks/use-meal-store': { useMealStore: () => mealStore, emptyDayLog: id => ({ ...mealStore.dayLogs[date], dateId: id, foods: [] }) },
  '@/hooks/use-weight-store': { useWeightStore: () => ({ weightsByDate: {}, syncError: null, saveWeight: (...args) => saves.push(args) }) },
  '@/hooks/use-preferences-store': { usePreferencesStore: () => ({ preferencesReady: true, weightTrackingEnabled: true, syncError: null }) },
  '@/hooks/use-logs-date': { useLogsSelectedDate: () => [date], logsDateStore: { get: () => date, getRevision: () => 4, subscribe: () => () => {}, set: value => selections.push(value) } },
  '@/theme': { useTheme: () => theme },
  '@/lib/dates': { ...dates, todayId: () => date },
  './daily-log-contract': daily, './interface-contract': contract,
};
const moduleUnderTest = new Module(filename, module);
moduleUnderTest.filename = filename;
moduleUnderTest.require = name => { if (name in stub) return stub[name]; throw Error('Unexpected dependency ' + name); };
moduleUnderTest._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const Screen = moduleUnderTest.exports.default;
const props = view => view.root.findByType('native-shell').props;
function event(props, action, sequence, extra = {}) {
  return { nativeEvent: { session: JSON.parse(props.data).session, commandRevision: 4, sequence, action, date, ...extra } };
}
test('real shell maps native records to canonical stores and rejects callbacks after blur/account replacement', async () => {
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(Screen)); });
  let p = props(view);
  await renderer.act(async () => { p.onAction(event(p, 'weight-save', 1, { input: { quantity: '72,5' } })); });
  assert.deepEqual(saves, [[date, 72500]]);
  await renderer.act(async () => { p.onAction(event(p, 'edit-save', 2, { ids: ['food'], time: '09:15', input: { quantity: '1,5', mode: 'portion', revision: 10 } })); });
  assert.deepEqual(updates, [[date, 'food', { portion: '1.5 taza', time: '09:15' }]]);
  assert.equal(doc.nutritionSnapshot.nutritionPer100.calories, 100);
  await renderer.act(async () => { p.onAction(event(p, 'register', 3, { date: '2026-10-17' })); });
  assert.equal(pushes[0].params.dateId, '2026-10-17', 'measurement-date registration must not use the visible food date');
  assert.deepEqual(selections, ['2026-10-17'], 'calendar registration must commit its return date before the form can blur or cancel');
  await renderer.act(async () => blur());
  await renderer.act(async () => { p.onAction(event(p, 'weight-save', 4, { input: { quantity: '80' } })); });
  assert.equal(saves.length, 1);
  await renderer.act(async () => { blur = focus(); });
  const newProps = props(view);
  assert.notEqual(JSON.parse(newProps.data).session, JSON.parse(p.data).session);
  await renderer.act(async () => { newProps.onAction(event(newProps, 'weight-save', 1, { input: { quantity: '73' } })); });
  assert.equal(saves.length, 2, 'new focus accepts a restarted sequence');
  p = newProps;
  user = { id: 'b', name: 'Cuenta B' };
  await renderer.act(async () => { view.update(React.createElement(Screen)); });
  await renderer.act(async () => { p.onAction(event(p, 'weight-save', 2, { input: { quantity: '90' } })); });
  assert.equal(saves.length, 2, 'an old account callback cannot mutate the replacement account');
  await renderer.act(async () => view.unmount());
});


test('retained native payload preserves work while blurred and refreshes the complete Organic scheme on focus', async () => {
  let view;
  const previousLogs = mealStore.dayLogs, previousDocs = mealStore.mealDocuments;
  const archivedDate = '2020-05-18', incomingDate = '2026-10-17';
  const historyDay = (id, day) => ({ ...previousLogs[date], dateId: day,
    foods: previousLogs[date].foods.map(food => ({ ...food, id })) });
  const historyDoc = (id, day) => ({ ...doc, id, consumedAt: dates.epochForChileDateTime(day, '08:15') });
  const archived = historyDoc('archived', archivedDate);
  mealStore.dayLogs = { ...previousLogs, [archivedDate]: historyDay('archived', archivedDate) };
  mealStore.mealDocuments = [...previousDocs, archived];
  try {
    await renderer.act(async () => { view = renderer.create(React.createElement(Screen)); });
    const initial = props(view).data;
    assert.equal(JSON.parse(initial).colors.scheme, 'dark');
    assert.deepEqual(JSON.parse(initial).colors.actionGradient, theme.gradients.action);
    assert.deepEqual(Object.keys(JSON.parse(initial).days).sort(), [archivedDate, date]);
    await renderer.act(async () => blur());
    theme = { colors: { background: '#eff7f7', primary: '#146477' }, scheme: 'light', gradients: { header: ['#cce8e4', '#d8e8f2'], action: ['#165f68', '#3b6274'] } };
    mealStore.dayLogs = { ...mealStore.dayLogs,
      [date]: { ...previousLogs[date], foods: previousLogs[date].foods.map(food => ({ ...food, calories: 60, protein: 1.8, carbs: 12, fat: .6 })) },
      [incomingDate]: historyDay('incoming', incomingDate) };
    mealStore.mealDocuments = [{ ...doc, canonicalQuantity: 60, entry: { ...doc.entry, enteredQuantity: 1.2 }, updatedAt: 11 }, archived, historyDoc('incoming', incomingDate)];
    await renderer.act(async () => view.update(React.createElement(Screen)));
    assert.equal(props(view).data, initial, 'theme and store changes behind the editor retain its previous native payload');
    await renderer.act(async () => { blur = focus(); });
    const refreshed = JSON.parse(props(view).data);
    assert.equal(refreshed.colors.scheme, 'light');
    assert.equal(refreshed.colors.background, '#eff7f7');
    assert.deepEqual(refreshed.colors.headerGradient, theme.gradients.header);
    assert.deepEqual(refreshed.colors.actionGradient, theme.gradients.action);
    assert.deepEqual(Object.keys(refreshed.days).sort(), [archivedDate, incomingDate, date]);
    assert.equal(refreshed.days[archivedDate].totals.calories, 50, 'distant history is not cropped or lost');
    assert.equal(refreshed.days[incomingDate].foods[0].id, 'incoming', 'history received while blurred appears on focus');
    assert.equal(refreshed.days[date].totals.calories, 60, 'edits received while blurred replace the old visible data');
  } finally {
    if (view) await renderer.act(async () => view.unmount());
    mealStore.dayLogs = previousLogs; mealStore.mealDocuments = previousDocs;
  }
});
