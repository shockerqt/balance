import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { useFoodSelection } from '../src/hooks/use-food-selection.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('a reused day view clears selection and never resurrects it on return', async () => {
  let selection;
  const Screen = ({ date }) => { selection = useFoodSelection(date); return null; };
  let renderer;
  await act(() => { renderer = create(React.createElement(Screen, { date: '2026-09-05' })); });
  await act(() => selection.startFromGroup(['a', 'b']));
  assert.equal(selection.selectedCount, 2);
  assert.equal(selection.isSelectionMode, true);
  await act(() => renderer.update(React.createElement(Screen, { date: '2026-09-06' })));
  assert.equal(selection.selectedCount, 0);
  assert.equal(selection.isSelectionMode, false);
  await act(() => selection.startFromFood({ id: 'c' }));
  assert.deepEqual([...selection.selectedIds], ['c']);
  await act(() => renderer.update(React.createElement(Screen, { date: '2026-09-05' })));
  assert.equal(selection.selectedCount, 0);
  await act(() => renderer.unmount());
});

test('group toggles, empty groups and stale day handlers cannot leak selection', async () => {
  let selection;
  const Screen = ({ date }) => { selection = useFoodSelection(date); return null; };
  let renderer;
  await act(() => { renderer = create(React.createElement(Screen, { date: 'a' })); });
  const oldStart = selection.startFromFood;
  const oldClear = selection.clear;
  const oldToggle = selection.toggleFood;
  await act(() => selection.startFromGroup([]));
  assert.equal(selection.isSelectionMode, false);
  await act(() => selection.toggleGroup(['a', 'b']));
  await act(() => selection.toggleFood('a'));
  assert.deepEqual([...selection.selectedIds], ['b']);
  await act(() => selection.toggleGroup(['a', 'b']));
  assert.equal(selection.selectedCount, 2);
  await act(() => selection.toggleGroup(['a', 'b']));
  assert.equal(selection.isSelectionMode, false);
  await act(() => renderer.update(React.createElement(Screen, { date: 'b' })));
  await act(() => selection.startFromFood({ id: 'current-day' }));
  await act(() => { oldStart({ id: 'from-old-day' }); oldClear(); oldToggle('from-old-day'); });
  assert.deepEqual([...selection.selectedIds], ['current-day']);
  await act(() => renderer.update(React.createElement(Screen, { date: 'a' })));
  assert.equal(selection.selectedCount, 0);
  await act(() => renderer.unmount());
});
