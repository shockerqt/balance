const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const local = createRequire(path.join(root, 'package.json'));
const ts = local('typescript');
const HOUR = 3_600_000, DAY = 24 * HOUR, LIMIT = 16_384;
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false,
});
const originalParts = epochMs => {
  const values = Object.fromEntries(dateFormatter.formatToParts(new Date(epochMs))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
};
const log = consumedAt => ({ id: 'test', nameSnapshot: 'Fixture', consumedAt, templateId: null,
  canonicalQuantity: 100, entry: { enteredQuantity: 100 },
  nutritionSnapshot: { canonicalUnit: 'g', nutritionPer100: { calories: 100, protein: 2, carbs: 20, fat: 1 } } });

// Fresh production modules and cache per case, without production test exports.
function runtime({ failConstruction = false, failMethods = false } = {}) {
  const metrics = { constructions: 0, format: 0, parts: 0 }, maps = [], modules = new Map();
  const controls = { failConstruction, failMethods };
  class TrackedMap extends Map { constructor(...args) { super(...args); maps.push(this); } }
  const countedIntl = Object.create(Intl);
  countedIntl.DateTimeFormat = function (...args) {
    metrics.constructions++;
    if (controls.failConstruction) throw Error('unavailable Intl');
    const formatter = new Intl.DateTimeFormat(...args);
    return new Proxy(formatter, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'format' || key === 'formatToParts') return (...values) => {
        metrics[key === 'format' ? 'format' : 'parts']++;
        if (controls.failMethods) throw Error('failed Intl');
        return value.apply(target, values);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  function load(filename) {
    const full = [filename, `${filename}.ts`, `${filename}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!full) return local(filename);
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} }; modules.set(full, module);
    const requireFrom = name => name.startsWith('@/') ? load(path.join(root, 'src', name.slice(2)))
      : name.startsWith('.') ? load(path.resolve(path.dirname(full), name)) : local(name);
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireFrom, Intl: countedIntl, Map: TrackedMap, Date }, { filename: full });
    return module.exports;
  }
  const dates = load(path.join(root, 'src/lib/dates.ts'));
  const adapter = load(path.join(root, 'src/services/sync/adapters.ts'));
  return { dates, adapter, metrics, maps, controls };
}
function equivalent(app, timestamp) {
  // JSON removes the VM realm prototype without masking value differences.
  assert.deepEqual(JSON.parse(JSON.stringify(app.dates.chileDateParts(timestamp))), originalParts(timestamp), String(timestamp));
  assert.equal(app.adapter.logToLoggedFood(log(timestamp)).time, timeFormatter.format(new Date(timestamp)), String(timestamp));
}

const offset = epochMs => {
  const p = originalParts(epochMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epochMs;
};
let transitions;
function providerTransitions() {
  if (transitions) return transitions;
  transitions = [];
  const end = Date.UTC(2100, 0, 1);
  let previousTime = 0, previousOffset = offset(0);
  for (let time = DAY; time <= end; time += DAY) {
    const nextOffset = offset(time);
    if (nextOffset !== previousOffset) {
      let lower = previousTime, upper = time;
      // Locate the first changed minute; supported Santiago transitions must
      // fall exactly on an hour, as required by the production bucket premise.
      while (upper - lower > 60_000) {
        const middle = Math.floor((lower + upper) / 120_000) * 60_000;
        if (offset(middle) === previousOffset) lower = middle; else upper = middle;
      }
      transitions.push({ time: upper, before: previousOffset, after: nextOffset });
    }
    previousTime = time;
    previousOffset = nextOffset;
  }
  return transitions;
}

test('Chile cache: production date and adapter match original Intl around every supported provider DST transition', () => {
  const app = runtime();
  const rows = providerTransitions();
  assert.ok(rows.length > 100, 'provider covers both DST directions over many years');
  assert.ok(rows.some(row => row.after > row.before) && rows.some(row => row.after < row.before));
  for (const { time } of rows) {
    assert.equal(time % HOUR, 0, `provider transition ${new Date(time).toISOString()} must be hour-aligned`);
    for (const delta of [-HOUR, -60_000, -1, -.1, 0, .1, 1, 59_999.9, HOUR]) equivalent(app, time + delta);
  }
});

test('Chile cache: calendar boundaries, historical/out-of-range and fractional Date TimeClip stay equivalent', () => {
  const app = runtime();
  for (const timestamp of [
    Date.UTC(1900, 0, 1), Date.UTC(1916, 6, 1, 2, 34, 59, 999), -1, -.1, 0, .1, 59_999.9,
    Date.UTC(1970, 0, 1, 3), Date.UTC(2024, 1, 29), Date.UTC(2026, 11, 31, 23, 59, 59, 999),
    Date.UTC(2099, 11, 31, 23, 59, 59, 999), Date.UTC(2100, 0, 1), Date.UTC(2100, 0, 1) + .1,
    Date.UTC(2150, 5, 1), -8_640_000_000_000_000, 8_640_000_000_000_000,
  ]) equivalent(app, timestamp);
  for (const { time } of providerTransitions().filter(row => new Date(row.time).getUTCFullYear() >= 2020 && new Date(row.time).getUTCFullYear() <= 2028)) {
    const before = app.dates.chileDateParts(time - HOUR);
    const after = app.dates.chileDateParts(time);
    for (const parts of [before, after]) {
      const dateId = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
      const hhmm = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
      const resolved = app.dates.epochForChileDateTime(dateId, hhmm);
      assert.ok(resolved !== null);
      assert.deepEqual(JSON.parse(JSON.stringify(app.dates.chileDateParts(resolved))), JSON.parse(JSON.stringify(parts)));
    }
  }
  assert.equal(app.dates.epochForChileDateTime('2026-09-06', '00:30'), null, 'skipped local hour remains invalid');
  const repeated = app.dates.epochForChileDateTime('2026-04-04', '23:30');
  assert.equal(repeated, Date.parse('2026-04-05T02:30:00Z'), 'repeated local hour retains original resolution');
});

test('Chile cache: shared date/time conversion calls Intl once per data hour on fresh shuffled 12000-document history', () => {
  const timestamps = Array.from({ length: 12000 }, (_, i) => Date.UTC(2024, 8, 9, 12) + Math.floor(i / 17) * DAY + (i % 17) * 3_000_000);
  let seed = 0x52bace;
  const shuffled = [...timestamps];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const expectedHours = new Set(timestamps.map(time => Math.floor(time / HOUR))).size;
  for (const order of [timestamps, [...timestamps].reverse(), shuffled]) {
    const app = runtime();
    for (const timestamp of order) {
      const expected = originalParts(timestamp);
      assert.equal(app.dates.toDateId(new Date(timestamp)), `${expected.year}-${String(expected.month).padStart(2, '0')}-${String(expected.day).padStart(2, '0')}`);
      assert.equal(app.adapter.logToLoggedFood(log(timestamp)).time, timeFormatter.format(new Date(timestamp)));
    }
    assert.equal(app.metrics.constructions, 1, 'one contemporary timezone formatter shared by date and time');
    assert.equal(app.metrics.parts, expectedHours);
    assert.equal(app.metrics.format, 0);
    for (const timestamp of order.slice(0, 50)) equivalent(app, timestamp);
    assert.equal(app.metrics.parts, expectedHours, 'retained hours do not miss on repeated access');
  }
});

test('Chile cache: bounded FIFO eviction recomputes an evicted hour correctly without growing memory', () => {
  const app = runtime(), start = Date.UTC(2024, 0, 1);
  for (let i = 0; i <= LIMIT; i++) app.dates.chileDateParts(start + i * HOUR + 1234);
  const cache = app.maps.find(map => map.size === LIMIT);
  assert.ok(cache, 'bounded production cache is visible through VM Map seam');
  const before = app.metrics.parts;
  equivalent(app, start + 1234);
  assert.equal(app.metrics.parts, before + 1, 'evicted hour is recalculated and then shared with time adapter');
  assert.equal(cache.size, LIMIT);
  equivalent(app, start + LIMIT * HOUR + 1234);
  assert.equal(app.metrics.parts, before + 1, 'most recently inserted hour is still retained');
});

test('Chile cache: invalid timestamps and construction/method failure retain original adapter UTC fallback', () => {
  for (const timestamp of [NaN, Infinity, -Infinity, 8_640_000_000_000_001]) {
    const app = runtime();
    assert.throws(() => app.dates.chileDateParts(timestamp), { name: 'RangeError' });
    assert.equal(app.adapter.logToLoggedFood(log(timestamp)).time, 'NaN:NaN');
  }
  for (const failures of [{ failConstruction: true }, { failMethods: true }]) {
    const app = runtime(failures);
    for (const timestamp of [Date.UTC(2026, 7, 20, 2, 30), Date.UTC(1900, 0, 1, 2, 30), Date.UTC(2150, 0, 1, 2, 30)]) {
      assert.equal(app.adapter.logToLoggedFood(log(timestamp)).time, '02:30');
    }
  }
});
