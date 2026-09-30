import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { dateIdToEpochDay } from '../src/lib/dates.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__dayWindowTest = { values: [] };
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['react-native', 'react-native-reanimated'].includes(specifier)) {
      return { url: `mock:${specifier}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith('mock:') && specifier === 'react') {
      return nextResolve(pathToFileURL(require.resolve('react')).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock:react-native') return { format: 'module', shortCircuit: true, source: `
      export const View = 'View';
      export const StyleSheet = { create: x => x, absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } };
      export const useWindowDimensions = () => ({ width: 400 });
    ` };
    if (url === 'mock:react-native-reanimated') return { format: 'module', shortCircuit: true, source: `
      import { useRef } from 'react';
      export default { View: 'AnimatedView' };
      export const Easing = { out: x => x, cubic: 'cubic' };
      export const ReduceMotion = { System: 'system' };
      export const useAnimatedStyle = read => ({ read });
      export const withTiming = target => ({ target });
      export const cancelAnimation = value => { value.pending = null; };
      export function useSharedValue(initial) {
        const ref = useRef(null);
        if (!ref.current) {
          let current = initial;
          ref.current = { pending: null, get value() { return current; }, set value(next) {
            if (typeof next === 'object') this.pending = next.target;
            else { current = next; this.pending = null; }
          } };
          globalThis.__dayWindowTest.values.push(ref.current);
        }
        return ref.current;
      }
    ` };
    return nextLoad(url, context);
  },
});
const { PreparedDayWindow } = await import('../src/components/meal/prepared-day-window.tsx');

const renderDay = dateId => React.createElement('Day', { dateId });
const renderWindow = dateId => React.createElement(PreparedDayWindow, { dateId, renderDay });
const paneFor = (renderer, dateId) => renderer.root.findAllByType('AnimatedView')
  .find(pane => pane.findByType('Day').props.dateId === dateId);
const x = pane => pane.props.style[1].read().transform[0].translateX;

test('a prepared neighbor keeps its native layout and identity through arrival and completion', async () => {
  let renderer;
  await act(() => { renderer = create(renderWindow('2026-09-05')); });
  const next = paneFor(renderer, '2026-09-06');
  const layout = next.props.style[0];
  assert.equal(x(next), 400);
  assert.equal(next.props.pointerEvents, 'none');
  await act(() => renderer.update(renderWindow('2026-09-06')));
  assert.equal(paneFor(renderer, '2026-09-06'), next);
  assert.equal(next.props.style[0], layout);
  assert.equal(x(next), 400); // No layout rebase while the animation is queued.
  const position = globalThis.__dayWindowTest.values.at(-1);
  position.value = dateIdToEpochDay('2026-09-05') + 0.5;
  assert.equal(x(next), 200);
  position.value = dateIdToEpochDay('2026-09-06');
  assert.equal(x(next), 0);
  assert.equal(next.props.style[0], layout); // Completion has no React recenter.
  assert.equal(next.props.pointerEvents, 'auto');
  assert.equal(renderer.root.findAllByType('AnimatedView').length, 3);
  await act(() => renderer.unmount());
});

test('rapid reversals continue from presentation position, distant jumps and resizing snap', async () => {
  let renderer;
  await act(() => { renderer = create(renderWindow('2026-09-05')); });
  const position = globalThis.__dayWindowTest.values.at(-1);
  const first = dateIdToEpochDay('2026-09-05');
  await act(() => renderer.update(renderWindow('2026-09-06')));
  position.value = first + 0.4;
  await act(() => renderer.update(renderWindow('2026-09-05')));
  assert.equal(position.value, first + 0.4);
  assert.equal(position.pending, first);
  assert.equal(x(paneFor(renderer, '2026-09-05')), (first - position.value) * 400);
  await act(() => renderer.update(renderWindow('2040-01-01')));
  assert.equal(position.value, dateIdToEpochDay('2040-01-01'));
  assert.equal(position.pending, null);
  assert.equal(x(paneFor(renderer, '2040-01-01')), 0);
  await act(() => renderer.root.findByType('View').props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  assert.equal(x(paneFor(renderer, '2040-01-02')), 320);
  assert.equal(renderer.root.findAllByType('AnimatedView').filter(pane => pane.props.pointerEvents === 'auto').length, 1);
  await act(() => renderer.unmount());
});

test.after(() => { hooks.deregister(); delete globalThis.__dayWindowTest; });
