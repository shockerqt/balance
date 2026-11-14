import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { useSyncExternalStore } from 'react';
import { act, create } from 'react-test-renderer';
import { dateIdToEpochDay } from '../src/lib/dates.ts';
import { createLogNavigation } from '../src/lib/log-navigation.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = globalThis.__legendWindowTest = { width: 400, scrollToCalls: [], reactions: [] };
const require = createRequire(import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['react-native', 'react-native-reanimated', '@legendapp/list/reanimated'].includes(specifier)) {
      return { url: `mock:${specifier}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith('mock:') && specifier === 'react') {
      return next(pathToFileURL(require.resolve('react')).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = source => ({ format: 'module', shortCircuit: true, source });
    if (url === 'mock:react-native') return result(`
      export const View = 'View';
      export const StyleSheet = { create: x => x };
      export const useWindowDimensions = () => ({ width: globalThis.__legendWindowTest.width });
    `);
    if (url === 'mock:@legendapp/list/reanimated') return result(`
      import React, { useEffect } from 'react';
      export function AnimatedLegendList(props) {
        useEffect(() => {
          if (typeof props.ref === 'function') {
            props.ref({ scrollToOffset: opts => globalThis.__legendWindowTest.scrollToCalls.push(opts) });
          }
        }, [props.ref]);
        const center = props.initialScrollIndex ?? 180;
        const indices = [center - 1, center, center + 1];
        return React.createElement('LegendPager', props, indices.map(i =>
          React.createElement(React.Fragment, { key: props.keyExtractor(props.data[i]) }, props.renderItem({ item: props.data[i], index: i }))
        ));
      }
    `);
    if (url === 'mock:react-native-reanimated') return result(`
      import { useEffect, useRef } from 'react';
      export const runOnUI = fn => (...args) => fn(...args);
      export function useSharedValue(initial) {
        const ref = useRef(null);
        if (!ref.current) ref.current = { value: initial };
        return ref.current;
      }
      export function useAnimatedReaction(prepare, react) {
        useEffect(() => {
          const r = { prepare, react, previous: undefined };
          globalThis.__legendWindowTest.reactions.push(r);
          return () => {
            const idx = globalThis.__legendWindowTest.reactions.indexOf(r);
            if (idx >= 0) globalThis.__legendWindowTest.reactions.splice(idx, 1);
          };
        }, []);
      }
    `);
    return next(url, context);
  },
});

const { LegendDayWindow } = await import('../src/components/meal/legend-day-window.tsx');
const renderDay = dateId => React.createElement('Day', { dateId });
const flushReactions = () => {
  for (const r of [...state.reactions]) {
    const next = r.prepare();
    if (next !== r.previous) {
      const prev = r.previous;
      r.previous = next;
      r.react(next, prev);
    }
  }
};

function setup() {
  const nav = createLogNavigation('2026-11-07');
  const position = { value: dateIdToEpochDay(nav.get()) }, interaction = { value: 0 };
  let commits = 0, active = true, scrollEnabled = true;
  const settle = (date, revision) => {
    if (revision !== nav.getRevision()) return;
    nav.set(date);
    return nav.getRevision();
  };
  function Host() {
    const date = useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    return React.createElement(React.Profiler, { id: 'host', onRender: () => commits++ },
      React.createElement(LegendDayWindow, {
        dateId: date,
        revision: nav.getRevision(),
        readRevision: nav.getRevision,
        position,
        interaction,
        active,
        scrollEnabled,
        onSettle: settle,
        renderDay,
      })
    );
  }
  return {
    nav,
    position,
    interaction,
    Host,
    commits: () => commits,
    lock: () => { scrollEnabled = false; },
    unlock: () => { scrollEnabled = true; },
    blur: () => { active = false; },
    focus: () => { active = true; },
  };
}

test('LegendDayWindow maps horizontal scrollOffset to UI position without React commits and settles on momentum end', async () => {
  const app = setup();
  let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const list = tree.root.findByType('LegendPager');
  const baseDay = dateIdToEpochDay('2026-11-07');
  const baseline = app.commits();
  await act(() => {
    list.props.onScrollBeginDrag();
    list.props.sharedValues.scrollOffset.value = 180.5 * 400;
    flushReactions();
  });
  assert.equal(app.commits(), baseline, 'continuous horizontal scroll frames do not commit React');
  assert.equal(app.interaction.value, 1);
  assert.ok(Math.abs(app.position.value - (baseDay + 0.5)) < 1e-9);
  await act(() => {
    list.props.onScrollEndDrag({ nativeEvent: { velocity: { x: 1.5 }, contentOffset: { x: 180.7 * 400 } } });
  });
  assert.equal(app.interaction.value, 2);
  assert.equal(app.nav.get(), '2026-11-07');
  const visibleNext = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-11-08');
  await act(() => {
    list.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 181 * 400 } } });
  });
  assert.equal(app.interaction.value, 0);
  assert.equal(app.nav.get(), '2026-11-08');
  assert.equal(app.position.value, dateIdToEpochDay('2026-11-08'));
  assert.equal(tree.root.findByType('LegendPager'), list, 'settling preserves the mounted LegendPager surface');
  assert.equal(tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-11-08'), visibleNext, 'visible page does not unmount on settle');
  await act(() => tree.unmount());
});

test('LegendDayWindow handles in-window and distant calendar jumps, blur and selection lock', async () => {
  const app = setup();
  let tree;
  await act(() => { tree = create(React.createElement(app.Host)); });
  const initialList = tree.root.findByType('LegendPager');
  state.scrollToCalls.length = 0;
  // In-window calendar jump reuses surface and calls scrollToOffset
  await act(() => app.nav.set('2026-11-12'));
  assert.equal(tree.root.findByType('LegendPager'), initialList);
  assert.deepEqual(state.scrollToCalls.at(-1), { offset: 185 * 400, animated: false });
  assert.equal(app.position.value, dateIdToEpochDay('2026-11-12'));
  // Lock prevents settle
  app.lock();
  await act(() => tree.update(React.createElement(app.Host)));
  assert.equal(tree.root.findByType('LegendPager').props.scrollEnabled, false);
  await act(() => {
    tree.root.findByType('LegendPager').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 186 * 400 } } });
  });
  assert.equal(app.nav.get(), '2026-11-12');
  app.unlock();
  await act(() => tree.update(React.createElement(app.Host)));
  // Distant jump mounts a fresh surface centered on the target
  await act(() => app.nav.set('2040-01-01'));
  assert.notEqual(tree.root.findByType('LegendPager'), initialList);
  assert.equal(app.position.value, dateIdToEpochDay('2040-01-01'));
  await act(() => tree.unmount());
});

test.after(() => {
  hooks.deregister();
  delete globalThis.__legendWindowTest;
});
