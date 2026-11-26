import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createMealDayProjector, createMealDaySubscriptions, emptyDayLog } from '../src/lib/meal-day-projection.ts';
import { epochForChileDateTime } from '../src/lib/dates.ts';

const meal = (id, date = '2026-11-06') => ({
  id, templateId: null, nameSnapshot: id,
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 1 } },
  canonicalQuantity: 100, entry: { enteredQuantity: 100 },
  consumedAt: epochForChileDateTime(date, '08:00'), updatedAt: 1, _deleted: false,
});

test('only affected days allocate new projection snapshots; moves, deletion and replacement invalidate both dates', () => {
  const project = createMealDayProjector();
  const first = meal('a'), second = meal('b'), other = meal('c', '2026-11-05');
  const initial = project([first, second, other]);
  assert.equal(project([first, second, other]), initial);
  const edited = { ...first, nameSnapshot: 'Edited', updatedAt: 2 };
  const changed = project([edited, second, other]);
  assert.notEqual(changed['2026-11-06'], initial['2026-11-06']);
  assert.equal(changed['2026-11-05'], initial['2026-11-05']);
  assert.equal(changed['2026-11-06'].foods[1], initial['2026-11-06'].foods[1]);
  assert.deepEqual(changed['2026-11-06'].foods.map(f => f.id), ['a', 'b']);
  const moved = { ...edited, consumedAt: other.consumedAt };
  const movedDays = project([moved, second, other]);
  assert.deepEqual(movedDays['2026-11-06'].foods.map(f => f.id), ['b']);
  assert.deepEqual(movedDays['2026-11-05'].foods.map(f => f.id), ['a', 'c']);
  const deleted = project([{ ...moved, _deleted: true }, second, other]);
  assert.equal(deleted['2026-11-06'], movedDays['2026-11-06']);
  assert.deepEqual(deleted['2026-11-05'].foods.map(f => f.id), ['c']);
  assert.deepEqual(project([]), {});
});

test('projection uses Chilean date identity and preserves unknown nutrients versus zero', () => {
  const project = createMealDayProjector();
  const first = meal('a');
  const zeroFiber = { ...meal('b'), nutritionSnapshot: { ...first.nutritionSnapshot,
    nutritionPer100: { ...first.nutritionSnapshot.nutritionPer100, fiber: 0 } } };
  const day = project([first, zeroFiber])['2026-11-06'];
  assert.equal(day.foods[0].fiber, undefined);
  assert.equal(day.foods[1].fiber, 0);
  assert.equal(day.foods[0].time, '08:00');
});

test('subscriptions notify only changed dates, install atomically, and release listeners', () => {
  const project = createMealDayProjector();
  const first = meal('a'), other = meal('b', '2026-11-05');
  const initial = project([first, other]);
  const store = createMealDaySubscriptions(initial);
  const untouched = store.get('2026-11-05');
  const empty = store.get('2040-01-01');
  assert.equal(store.get('2040-01-01'), empty);
  let changedCalls = 0, untouchedCalls = 0, emptyCalls = 0;
  const unsub = store.subscribe('2026-11-06', () => {
    changedCalls++;
    assert.equal(store.get('2026-11-05'), untouched);
    assert.equal(store.get('2026-11-06').foods[0].name, 'Edited');
  });
  store.subscribe('2026-11-05', () => untouchedCalls++);
  store.subscribe('2040-01-01', () => emptyCalls++);
  store.publish(project([{ ...first, nameSnapshot: 'Edited' }, other]));
  store.publish(project([{ ...first, nameSnapshot: 'Edited' }, other]));
  assert.equal(changedCalls, 2);
  assert.equal(untouchedCalls, 0);
  assert.equal(emptyCalls, 0);
  assert.equal(store.get('2040-01-01'), empty);
  unsub();
  store.publish(project([other]));
  assert.equal(changedCalls, 2);
  assert.deepEqual(store.get('2026-11-06'), emptyDayLog('2026-11-06'));
});

test('replacing the account adapter exposes no prior account data', () => {
  const old = createMealDaySubscriptions({ '2026-11-06': { ...emptyDayLog('2026-11-06'), foods: [{ id: 'private' }] } });
  const next = createMealDaySubscriptions();
  assert.equal(old.get('2026-11-06').foods.length, 1);
  assert.equal(next.get('2026-11-06').foods.length, 0);
});

test('createMealDayProjector converts documents lazily per read date and isolates retained snapshots', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const local = createRequire(path.join(root, 'package.json'));
  const ts = local('typescript');
  let conversions = 0;
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const requireLocal = name => {
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (resolved) return load(resolved);
      }
      return local(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(requireLocal, module, module.exports);
    if (filename.endsWith('/sync/adapters.ts')) {
      const original = module.exports.logToLoggedFood;
      module.exports.logToLoggedFood = (...args) => {
        conversions++;
        return original(...args);
      };
    }
    return module.exports;
  }
  const projection = load(path.join(root, 'src/lib/meal-day-projection.ts'));
  const project = projection.createMealDayProjector();
  const a = meal('a', '2026-11-06');
  const b = meal('b', '2026-11-06');
  const c = meal('c', '2026-11-05');
  const d = meal('d', '2026-11-04');

  const s1 = project([a, b, c, d]);
  assert.equal(conversions, 0, 'projecting does not convert any document eagerly');
  assert.deepEqual(Object.keys(s1), ['2026-11-06', '2026-11-05', '2026-11-04']);
  assert.equal(conversions, 0, 'Object.keys does not trigger lazy conversion');

  const day6 = s1['2026-11-06'];
  assert.equal(conversions, 2, 'reading one date converts only its documents');
  assert.equal(s1['2026-11-06'], day6, 'repeated reads return the cached DayLog reference');
  assert.equal(conversions, 2);

  // Retain s1 without reading s1['2026-11-05'], then project an update to 2026-11-05.
  const store = projection.createMealDaySubscriptions(s1);
  store.subscribe('2026-11-06', () => {});
  const s2 = project([a, b, { ...c, nameSnapshot: 'Updated c', updatedAt: 2 }, d]);
  store.publish(s2);
  assert.equal(conversions, 2, 'publishing to a single-date subscriber does not convert other changed or unread dates');
  assert.equal(s2['2026-11-06'], day6, 'unchanged date keeps exact DayLog reference');
  assert.equal(conversions, 2);

  assert.equal(s1['2026-11-05'].foods[0].name, 'c', 'retained snapshot preserves its point-in-time documents');
  assert.equal(conversions, 3);
  assert.equal(s2['2026-11-05'].foods[0].name, 'Updated c');
  assert.equal(conversions, 4);
  // Unread date 2026-11-04 was never converted.
  assert.equal(conversions, 4);
});
