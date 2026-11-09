import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { useSyncExternalStore } from 'react';
import { act, create } from 'react-test-renderer';
import { createLogNavigation } from '../src/lib/log-navigation.ts';
import { dateIdToEpochDay } from '../src/lib/dates.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = globalThis.__nativeWindowTest = { js: [], frames: new Map(), nextFrame: 0, width: 400 };
const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = fn => { const id = ++state.nextFrame; state.frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = id => state.frames.delete(id);
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['react-native', 'react-native-reanimated', 'react-native-pager-view'].includes(specifier)) return { url: `mock:${specifier}`, shortCircuit: true };
    if (context.parentURL?.startsWith('mock:') && specifier === 'react') return next(pathToFileURL(require.resolve('react')).href, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = source => ({ format: 'module', shortCircuit: true, source });
    if (url === 'mock:react-native') return result(`
      export const View = 'View';
      export const StyleSheet = { create: x => x };
      export const useWindowDimensions = () => ({ width: globalThis.__nativeWindowTest.width });
    `);
    if (url === 'mock:react-native-pager-view') return result(`export default 'RawPager';`);
    if (url === 'mock:react-native-reanimated') return result(`
      import { useRef } from 'react';
      export default { createAnimatedComponent: () => 'NativePager' };
      export const runOnUI = fn => (...args) => fn(...args);
      export const runOnJS = fn => (...args) => globalThis.__nativeWindowTest.js.push(() => fn(...args));
      export const useEvent = fn => fn;
      export const useSharedValue = value => { const ref = useRef({ value }); return ref.current; };
    `);
    return next(url, context);
  },
});
const { NativeDayWindow } = await import('../src/components/meal/native-day-window.tsx');
const renderDay = dateId => React.createElement('Day', { dateId });
const flushJS = () => { for (const fn of state.js.splice(0)) fn(); };
const flushFrames = () => { for (const [id, fn] of [...state.frames]) { state.frames.delete(id); fn(); } };
const pager = tree => tree.root.findByType('NativePager');
const selected = (p, index) => p.props.onPageSelected({ nativeEvent: { position: index } });
const phase = (p, value) => p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: value } });
const scroll = (p, index, offset) => p.props.onPageScroll({ eventName: 'onPageScroll', position: index, offset });
function setup() {
  const nav = createLogNavigation('2026-11-07');
  const position = { value: dateIdToEpochDay(nav.get()) }, interaction = { value: 0 };
  let commits = 0, active = true, scrollEnabled = true;
  const settle = (date, revision) => {
    if (revision !== nav.getRevision()) return;
    nav.set(date); return nav.getRevision();
  };
  function Host() {
    const date = useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    return React.createElement(React.Profiler, { id: 'host', onRender: () => commits++ },
      React.createElement(NativeDayWindow, { dateId: date, revision: nav.getRevision(), readRevision: nav.getRevision,
        position, interaction, active, scrollEnabled, onSettle: settle, renderDay }));
  }
  return { nav, position, interaction, Host, commits: () => commits, lock: () => { scrollEnabled = false; }, unlock: () => { scrollEnabled = true; }, blur: () => { active = false; }, focus: () => { active = true; } };
}
async function mount(app) {
  let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  assert.equal(tree.root.findAllByType('Day').length, 1, 'initial commit mounts target content first');
  await act(() => { selected(pager(tree), 7); flushFrames(); });
  assert.equal(tree.root.findAllByType('Day').length, 15);
  return tree;
}

test('native scroll frames and selected events do not commit React or change the date before idle', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  const baseline = app.commits(), day = app.position.value;
  await act(() => {
    phase(p, 'dragging');
    for (let i = 0; i <= 200; i++) scroll(p, 7, i / 200);
    phase(p, 'settling'); selected(p, 8);
  });
  assert.equal(app.commits(), baseline);
  assert.equal(app.nav.get(), '2026-11-07');
  assert.equal(app.position.value, day + 1);
  await act(() => { phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  assert.equal(pager(tree), p, 'ordinary acknowledgement never remounts/recenters the native pager');
  assert.equal(pager(tree).props.initialPage, 7);
  await act(() => tree.unmount());
});

test('rapid native swipes discard a queued older idle callback and acknowledge only the final settled index', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree), baseline = app.commits();
  await act(() => {
    phase(p, 'dragging'); scroll(p, 7, 0.5); phase(p, 'settling'); selected(p, 8); phase(p, 'idle');
    phase(p, 'dragging'); scroll(p, 8, 0.6); phase(p, 'settling'); selected(p, 9); phase(p, 'idle');
  });
  assert.equal(app.commits(), baseline);
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2026-11-09');
  assert.equal(pager(tree), p);
  await act(() => tree.unmount());
});

test('an own acknowledgement during the next native drag preserves presentation and updates its revision', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree), day = app.position.value;
  await act(() => {
    phase(p, 'dragging'); phase(p, 'settling'); selected(p, 8); phase(p, 'idle'); flushJS();
    phase(p, 'dragging'); scroll(p, 8, 0.3);
  });
  assert.equal(app.nav.get(), '2026-11-08');
  assert.ok(Math.abs(app.position.value - day - 1.3) < 1e-9);
  assert.equal(app.interaction.value, 1);
  assert.equal(pager(tree), p);
  await act(() => { phase(p, 'settling'); selected(p, 9); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-09');
  await act(() => tree.unmount());
});

test('calendar jumps, blur/return and resize discard callbacks from old native surfaces', async () => {
  const app = setup(), tree = await mount(app), old = pager(tree);
  const oldProps = old.props;
  await act(() => { phase(old, 'dragging'); phase(old, 'settling'); selected(old, 8); phase(old, 'idle'); });
  await act(() => app.nav.set('2040-01-01'));
  assert.notEqual(pager(tree), old);
  assert.equal(tree.root.findAllByType('Day').length, 1);
  assert.equal(app.position.value, dateIdToEpochDay('2040-01-01'));
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2040-01-01');
  app.blur(); await act(() => tree.update(React.createElement(app.Host)));
  app.focus(); await act(() => tree.update(React.createElement(app.Host)));
  await act(() => {
    oldProps.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'dragging' } });
    oldProps.onPageSelected({ nativeEvent: { position: 9 } });
    oldProps.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'idle' } }); flushJS();
  });
  assert.equal(app.nav.get(), '2040-01-01');
  const beforeResize = pager(tree);
  state.width = 320;
  await act(() => tree.update(React.createElement(app.Host)));
  assert.notEqual(pager(tree), beforeResize);
  state.width = 400;
  await act(() => tree.unmount());
});

test('window edges rebase only after settling, preserving the selected date and rejecting the old view', async () => {
  const app = setup(), tree = await mount(app), old = pager(tree);
  await act(() => { phase(old, 'dragging'); phase(old, 'settling'); selected(old, 13); });
  assert.equal(pager(tree), old);
  await act(() => { phase(old, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-13');
  assert.notEqual(pager(tree), old);
  assert.equal(pager(tree).props.initialPage, 7);
  assert.equal(app.position.value, dateIdToEpochDay('2026-11-13'));
  await act(() => tree.unmount());
});

test('non-touch native accessibility paging settles without a dragging state', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { phase(p, 'settling'); selected(p, 8); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('Strict Mode effect cleanup and restoration leave native interaction enabled', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(app.Host))); });
  await act(() => { selected(pager(tree), 7); flushFrames(); });
  const p = pager(tree);
  await act(() => { phase(p, 'dragging'); scroll(p, 7, 0.5); phase(p, 'settling'); selected(p, 8); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('selection locks paging without remounting the native surface and rejects queued idle acknowledgements', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { phase(p, 'dragging'); phase(p, 'settling'); selected(p, 8); phase(p, 'idle'); });
  app.lock(); await act(() => tree.update(React.createElement(app.Host)));
  assert.equal(pager(tree), p);
  assert.equal(pager(tree).props.scrollEnabled, false);
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2026-11-07');
  app.unlock(); await act(() => tree.update(React.createElement(app.Host)));
  assert.equal(pager(tree), p);
  assert.equal(pager(tree).props.scrollEnabled, true);
  await act(() => tree.unmount());
});

test('a selected page arriving before dragging still updates the date when native becomes idle', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { selected(p, 8); phase(p, 'dragging'); phase(p, 'settling'); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('selected plus idle can acknowledge a real page even when intermediate scroll states were omitted', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { selected(p, 8); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('own acknowledgements and a reversal in the same native batch use the live revision before React props commit', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => {
    phase(p, 'dragging'); selected(p, 8); phase(p, 'idle'); flushJS();
    assert.equal(app.nav.get(), '2026-11-08');
    phase(p, 'dragging'); selected(p, 7); phase(p, 'idle'); flushJS();
    assert.equal(app.nav.get(), '2026-11-07');
  });
  assert.equal(pager(tree), p);
  await act(() => {
    app.nav.set('2040-01-01');
    // Old native events cannot capture the new authority revision before the
    // calendar target has even committed/replaced their surface.
    phase(p, 'dragging'); selected(p, 8); phase(p, 'idle'); flushJS();
  });
  assert.equal(app.nav.get(), '2040-01-01');
  await act(() => tree.unmount());
});

test.after(() => {
  hooks.deregister(); delete globalThis.__nativeWindowTest;
  globalThis.requestAnimationFrame = originalRAF; globalThis.cancelAnimationFrame = originalCancel;
});
