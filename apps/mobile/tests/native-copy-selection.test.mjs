import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelectionCopy, selectionCopyPlanIsCurrent } from '../src/components/meal/native/copy-selection-contract.ts';
import { acceptDailyEvent } from '../src/components/meal/native/daily-log-contract.ts';
import { chileTimeString, epochForChileDateTime, toDateId } from '../src/lib/dates.ts';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = '2026-10-30';
const meal = (n, time = '08:15') => ({
  id: uuid(n), templateId: null, nameSnapshot: 'Snapshot histórico',
  nutritionSnapshot: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: {
    calories: 123.4567, protein: 3.7654, carbs: 9, fat: 0, fiber: null,
    extendedNutrition: { ironMg: .12345, vitaminB12Mcg: 0 },
  } },
  canonicalQuantity: 75.125, entry: { enteredQuantity: 1.5, portionSnapshot: {
    portionId: 'portion-historical', name: 'porción original', portionQuantity: 2, canonicalQuantity: 100.16666666666667,
  } },
  consumedAt: epochForChileDateTime(date, time), updatedAt: 1000 + n, _deleted: false,
  provenance: { provider: 'macrofactor', externalId: `source-${n}` },
});
const input = docs => ({ operationId: uuid(900), sourceDate: date, ids: docs.map(d => d.id),
  revisions: Object.fromEntries(docs.map(d => [d.id, d.updatedAt])), destinationDate: '2026-11-01', time: '14:25' });

test('copy preserves canonical historical quantities/snapshots, creates fresh IDs and removes import identity', () => {
  const original = [meal(1), { ...meal(2, '19:40'), nutritionSnapshot: { ...meal(2).nutritionSnapshot, canonicalUnit: 'ml' } }];
  const bytes = JSON.stringify(original);
  let id = 100;
  const plan = prepareSelectionCopy(input(original), original, () => uuid(++id), 2000);
  assert.equal(JSON.stringify(original), bytes);
  assert.deepEqual(plan.documents.map(d => d.id), [uuid(101), uuid(102)]);
  for (let i = 0; i < original.length; i++) {
    const copy = plan.documents[i], source = original[i];
    assert.deepEqual(copy.nutritionSnapshot, source.nutritionSnapshot);
    assert.deepEqual(copy.entry, source.entry);
    assert.equal(copy.canonicalQuantity, source.canonicalQuantity);
    assert.equal(copy.templateId, null);
    assert.equal(Object.hasOwn(copy, 'provenance'), false);
    assert.deepEqual(copy.copySource, { id: source.id, updatedAt: source.updatedAt });
    assert.equal(copy.consumedAt, epochForChileDateTime('2026-11-01', '14:25'));
    assert.equal(toDateId(new Date(copy.consumedAt)), '2026-11-01');
    assert.notEqual(copy.nutritionSnapshot, source.nutritionSnapshot);
    assert.notEqual(copy.nutritionSnapshot.nutritionPer100.extendedNutrition, source.nutritionSnapshot.nutritionPer100.extendedNutrition);
  }
  assert.equal(selectionCopyPlanIsCurrent(plan, original), true);
  assert.equal(selectionCopyPlanIsCurrent(plan, original.map(d => ({ ...d, updatedAt: d.updatedAt + 1 }))), false);
});

test('one frozen plan retains its IDs and destination for retries and supports intentional same-time copying', () => {
  const original = [meal(1)];
  const request = { ...input(original), destinationDate: date, time: '08:15' };
  const plan = prepareSelectionCopy(request, original, () => uuid(101), 2000);
  const bytes = JSON.stringify(plan);
  request.ids.push(uuid(2)); request.revisions[uuid(1)] = 9999;
  assert.equal(JSON.stringify(plan), bytes);
  assert.equal(plan.documents[0].consumedAt, original[0].consumedAt);
  assert.equal(plan.documents[0].id, uuid(101));
});

test('changed/deleted/missing/wrong-day selection and duplicate IDs fail before allocating a copy', () => {
  const original = [meal(1)];
  let allocations = 0;
  const allocate = () => { allocations++; return uuid(101); };
  const request = input(original);
  for (const docs of [[], [{ ...original[0], _deleted: true }], [{ ...original[0], updatedAt: 3000 }],
    [{ ...original[0], consumedAt: epochForChileDateTime('2026-10-29', '08:15') }]]) {
    assert.throws(() => prepareSelectionCopy(request, docs, allocate, 2000), /seleccionar|cambiaron/);
  }
  assert.throws(() => prepareSelectionCopy({ ...request, ids: [uuid(1), uuid(1)] }, original, allocate, 2000));
  assert.equal(allocations, 0);
  assert.throws(() => prepareSelectionCopy(request, original, () => original[0].id, 2000));
});

test('Chilean destination rejects impossible dates, DST holes and the unsupported nonpositive epoch', () => {
  const original = [meal(1)], request = input(original);
  for (const [destinationDate, time] of [['2026-02-30', '10:15'], ['2026-09-06', '00:30'], ['1900-01-01', '12:00'], [date, '25:00']]) {
    assert.throws(() => prepareSelectionCopy({ ...request, destinationDate, time }, original, () => uuid(101), 2000));
  }
});

test('omitted, null or empty time keeps every source Chile time on the destination day; a time still overrides', () => {
  const original = [meal(1, '08:15'), meal(2, '19:40'), meal(3, '23:59')];
  for (const time of [undefined, null, '']) {
    const request = { ...input(original), time };
    if (time === undefined) delete request.time;
    let id = 100;
    const plan = prepareSelectionCopy(request, original, () => uuid(++id), 2000);
    assert.deepEqual(plan.documents.map(d => chileTimeString(d.consumedAt)), ['08:15', '19:40', '23:59']);
    assert.ok(plan.documents.every(d => toDateId(new Date(d.consumedAt)) === '2026-11-01'));
    assert.deepEqual(plan.documents.map(d => d.consumedAt), ['08:15', '19:40', '23:59'].map(t => epochForChileDateTime('2026-11-01', t)));
  }
  let id = 100;
  const fixed = prepareSelectionCopy(input(original), original, () => uuid(++id), 2000);
  assert.ok(fixed.documents.every(d => d.consumedAt === epochForChileDateTime('2026-11-01', '14:25')));
});

test('original hours reject a nonexistent Chilean DST hour and invalid days before allocating any ID', () => {
  const early = { ...meal(1, '00:30') }, morning = meal(2, '08:15');
  let allocations = 0;
  const allocate = () => uuid(100 + ++allocations);
  assert.throws(() => prepareSelectionCopy({ ...input([morning, early]), destinationDate: '2026-09-06', time: null }, [morning, early], allocate, 2000),
    /Las 00:30 no existen el 2026-09-06/);
  for (const destinationDate of ['2026-02-30', '1900-01-01'])
    assert.throws(() => prepareSelectionCopy({ ...input([morning]), destinationDate, time: null }, [morning], allocate, 2000), /no existe|válidas/);
  assert.throws(() => prepareSelectionCopy({ ...input([morning]), time: 1415 }, [morning], allocate, 2000), /válidas/);
  assert.equal(allocations, 0);
  const plan = prepareSelectionCopy({ ...input([morning]), destinationDate: '2026-09-06', time: null }, [morning], allocate, 2000);
  assert.equal(chileTimeString(plan.documents[0].consumedAt), '08:15');
  assert.equal(toDateId(new Date(plan.documents[0].consumedAt)), '2026-09-06');
});

test('original hours on the repeated Chilean fall-back hour keep the wall-clock time and day', () => {
  const late = meal(1, '23:30');
  const plan = prepareSelectionCopy({ ...input([late]), destinationDate: '2026-04-04', time: null }, [late], () => uuid(101), 2000);
  assert.equal(chileTimeString(plan.documents[0].consumedAt), '23:30');
  assert.equal(toDateId(new Date(plan.documents[0].consumedAt)), '2026-04-04');
});

test('copy bridge binds operation, context, sequence and revision map before local preparation', () => {
  const doc = meal(1), request = input([doc]);
  const event = { session: 'current', sequence: 3, commandRevision: 4, date, action: 'copy', ids: request.ids,
    time: request.time, input: { operationId: request.operationId, destinationDate: request.destinationDate, revisions: request.revisions } };
  const logs = { [date]: { foods: [{ id: doc.id }] } };
  assert.equal(acceptDailyEvent(event, 'current', 2, date, logs, 4), true);
  for (const candidate of [{ ...event, session: 'old' }, { ...event, sequence: 2 }, { ...event, commandRevision: 3 },
    { ...event, date: '2026-10-29' }, { ...event, ids: [doc.id, doc.id] }, { ...event, input: { ...event.input, revisions: {} } },
    { ...event, input: { ...event.input, operationId: 'invalid' } }, { ...event, time: '24:00' }]) {
    assert.equal(acceptDailyEvent(candidate, 'current', 2, date, logs, 4), false);
  }
});
