import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogNavigation, swipeDateOffset } from '../src/lib/log-navigation.ts';

test('rapid day commands accumulate without waiting for a render', () => {
  const store = createLogNavigation('2026-08-31');
  let notifications = 0;
  store.subscribe(() => notifications++);
  for (let i = 0; i < 100; i++) store.shift(1);
  assert.equal(store.get(), '2026-12-09');
  for (let i = 0; i < 100; i++) store.shift(-1);
  assert.equal(store.get(), '2026-08-31');
  assert.equal(notifications, 200);
});

test('calendar jump invalidates a pending gesture, including away-and-back jumps', () => {
  const store = createLogNavigation('2026-09-05');
  const gestureRevision = store.getRevision();
  store.set('2024-02-29');
  store.set('2026-09-05');
  store.shift(1, gestureRevision);
  assert.equal(store.get(), '2026-09-05');
});

test('one gesture cannot commit twice or undo a newer button command', () => {
  const store = createLogNavigation('2026-12-31');
  const revision = store.getRevision();
  store.shift(1, revision);
  store.shift(1, revision);
  assert.equal(store.get(), '2027-01-01');
  const nextRevision = store.getRevision();
  store.shift(-1);
  store.shift(7, nextRevision);
  assert.equal(store.get(), '2026-12-31');
});

test('week gestures preserve weekday across distant dates and DST', () => {
  const store = createLogNavigation('2026-09-05');
  store.shift(7);
  assert.equal(store.get(), '2026-09-12');
  store.set('2024-02-29');
  store.shift(7);
  assert.equal(store.get(), '2024-03-07');
  store.shift(-7);
  assert.equal(store.get(), '2024-02-29');
});

test('render reads and selecting the same date never emit navigation', () => {
  const store = createLogNavigation('2026-09-05');
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  for (let i = 0; i < 1000; i++) {
    store.get(); store.getRevision(); store.set(store.get());
  }
  assert.equal(calls, 0);
  unsubscribe();
  store.shift(1);
  assert.equal(calls, 0);
});

test('only deliberate completed horizontal swipes issue a command', () => {
  assert.equal(swipeDateOffset(-80, 3, true), 1);
  assert.equal(swipeDateOffset(80, -3, true), -1);
  assert.equal(swipeDateOffset(-200, 0, false), 0);
  assert.equal(swipeDateOffset(-30, 0, true), 0);
  assert.equal(swipeDateOffset(10, 200, true), 0);
  assert.equal(swipeDateOffset(80, 70, true), 0);
  assert.equal(swipeDateOffset(0, 0, true), 0);
});
