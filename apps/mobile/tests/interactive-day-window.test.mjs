import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { useSyncExternalStore } from 'react';
import { act, create } from 'react-test-renderer';
import { dateIdToEpochDay, epochDayToDateId } from '../src/lib/dates.ts';
import { createLogNavigation } from '../src/lib/log-navigation.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = globalThis.__pagerTest = { gestures: [], js: [], frames: new Map(), nextFrame: 0 };
const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = callback => { const id = ++state.nextFrame; state.frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => state.frames.delete(id);
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['react-native', 'react-native-reanimated', 'react-native-gesture-handler'].includes(specifier)) return { url: `mock:${specifier}`, shortCircuit: true };
    if (context.parentURL?.startsWith('mock:') && specifier === 'react') return next(pathToFileURL(require.resolve('react')).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = source => ({ format: 'module', shortCircuit: true, source });
    if (url === 'mock:react-native') return result(`
      export const View = 'View';
      export const StyleSheet = { create: x => x };
      export const useWindowDimensions = () => ({ width: 400 });
    `);
    if (url === 'mock:react-native-gesture-handler') return result(`
      export const GestureDetector = 'GestureDetector';
      export const Gesture = { Pan() {
        const handlers = {};
        const gesture = { handlers };
        for (const name of ['enabled', 'maxPointers', 'activeOffsetX', 'failOffsetY']) gesture[name] = () => gesture;
        for (const name of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[name] = fn => { handlers[name] = fn; return gesture; };
        globalThis.__pagerTest.gestures.push(gesture);
        return gesture;
      } };
    `);
    if (url === 'mock:react-native-reanimated') return result(`
      import { useRef } from 'react';
      export default { View: 'AnimatedView' };
      export const ReduceMotion = { System: 'system' };
      export const useAnimatedStyle = read => ({ read });
      export const runOnJS = fn => (...args) => globalThis.__pagerTest.js.push(() => fn(...args));
      export const withSpring = (target, config, callback) => ({ target, callback });
      export const cancelAnimation = value => { const pending = value.pending; value.pending = null; pending?.callback?.(false); };
      export function useSharedValue(initial) {
        const ref = useRef(null);
        if (!ref.current) {
          let current = initial;
          ref.current = { pending: null, get value() { return current; }, set value(next) {
            if (typeof next === 'object' && next !== null && 'target' in next) this.pending = next;
            else { current = next; this.pending = null; }
          } };
        }
        return ref.current;
      }
    `);
    return next(url, context);
  },
});
const { InteractiveDayWindow } = await import('../src/components/meal/interactive-day-window.tsx');
const renderDay = dateId => React.createElement('Day', { dateId });
const pane = (tree, date) => tree.root.findAllByType('AnimatedView').find(p => p.findByType('Day').props.dateId === date);
const x = pane => pane.props.style[1].read().transform[0].translateX;
const flushJS = () => { for (const fn of state.js.splice(0)) fn(); };
const flushFrames = () => { for (const [id, fn] of [...state.frames]) { state.frames.delete(id); fn(); } };
const finish = value => { const animation = value.pending; value.value = animation.target; animation.callback?.(true); };
function setup() {
  const nav = createLogNavigation('2026-11-06');
  const position = { value: dateIdToEpochDay(nav.get()), pending: null };
  // External shared values implement Reanimated assignment like the hook mock.
  let current = position.value;
  Object.defineProperty(position, 'value', { get: () => current, set(next) {
    if (typeof next === 'object') position.pending = next;
    else { current = next; position.pending = null; }
  } });
  const interaction = { value: 0 };
  let commits = 0, active = true;
  const settle = (target, revision) => {
    if (revision === nav.getRevision()) nav.shift(dateIdToEpochDay(target) - dateIdToEpochDay(nav.get()), revision);
  };
  function Host() {
    const date = useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    return React.createElement(React.Profiler, { id: 'host', onRender: () => commits++ },
      React.createElement(InteractiveDayWindow, { dateId: date, revision: nav.getRevision(), position, interaction, active, onSettle: settle, renderDay }));
  }
  return { nav, position, interaction, Host, commits: () => commits, blur: () => { active = false; }, focus: () => { active = true; } };
}

test('drag frames update translation with zero React commits; only completed settle changes the authority', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const neighbor = pane(tree, '2026-11-07');
  const baseline = app.commits();
  const g = state.gestures.at(-1).handlers;
  await act(() => { g.onBegin(); g.onStart(); flushJS(); for (let px = 1; px <= 200; px++) g.onUpdate({ translationX: -px }); });
  assert.equal(app.commits(), baseline);
  assert.equal(app.nav.get(), '2026-11-06');
  assert.equal(app.interaction.value, 1);
  assert.equal(x(neighbor), 200);
  await act(() => g.onEnd({ translationX: -200, velocityX: 0 }, true));
  assert.equal(app.nav.get(), '2026-11-06');
  await act(() => { finish(app.position); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-07');
  assert.equal(pane(tree, '2026-11-07'), neighbor);
  assert.equal(x(neighbor), 0);
  assert.equal(neighbor.props.pointerEvents, 'auto');
  await act(() => tree.unmount());
});

test('distant jumps mount the target directly before preparing neighbors and invalidate queued settle', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const g = state.gestures.at(-1).handlers;
  await act(() => { g.onBegin(); g.onStart(); g.onUpdate({ translationX: -200 }); g.onEnd({ translationX: -200, velocityX: 0 }, true); finish(app.position); });
  await act(() => app.nav.set('2040-01-01'));
  assert.equal(app.position.value, dateIdToEpochDay('2040-01-01'));
  assert.equal(app.position.pending, null);
  assert.equal(tree.root.findAllByType('Day').length, 1);
  assert.equal(x(pane(tree, '2040-01-01')), 0);
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2040-01-01');
  await act(() => flushFrames());
  assert.equal(tree.root.findAllByType('Day').length, 3);
  await act(() => tree.unmount());
});

test('short and cancelled drags return to the current date; blur rejects queued completion', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  let g = state.gestures.at(-1).handlers;
  await act(() => { g.onBegin(); g.onStart(); g.onUpdate({ translationX: -20 }); g.onEnd({ translationX: -20, velocityX: 0 }, true); finish(app.position); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-06');
  await act(() => { g.onBegin(); g.onStart(); g.onUpdate({ translationX: -200 }); g.onFinalize(); finish(app.position); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-06');
  await act(() => { g.onBegin(); g.onStart(); g.onUpdate({ translationX: -200 }); g.onEnd({ translationX: -200, velocityX: 0 }, true); finish(app.position); });
  app.blur();
  await act(() => tree.update(React.createElement(app.Host)));
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2026-11-06');
  assert.equal(tree.root.findAllByType('AnimatedView').every(p => p.props.pointerEvents === 'none'), true);
  await act(() => tree.unmount());
});

test('a queued settle cannot survive blur and return with the same revision', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const g = state.gestures.at(-1).handlers;
  await act(() => { g.onBegin(); g.onStart(); g.onUpdate({ translationX: -200 }); g.onEnd({ translationX: -200, velocityX: 0 }, true); finish(app.position); });
  app.blur(); await act(() => tree.update(React.createElement(app.Host)));
  app.focus(); await act(() => tree.update(React.createElement(app.Host)));
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2026-11-06');
  assert.equal(app.position.value, dateIdToEpochDay('2026-11-06'));
  await act(() => tree.unmount());
});

test('an external command before pan activation cancels that touch sequence', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const g = state.gestures.at(-1).handlers;
  await act(() => g.onBegin());
  await act(() => app.nav.shift(1));
  await act(() => { g.onStart(); g.onUpdate({ translationX: -200 }); g.onEnd({ translationX: -200, velocityX: 0 }, true); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-07');
  assert.equal(app.position.pending, null);
  await act(() => tree.unmount());
});

test.after(() => {
  hooks.deregister(); delete globalThis.__pagerTest;
  globalThis.requestAnimationFrame = originalRAF; globalThis.cancelAnimationFrame = originalCancel;
});
