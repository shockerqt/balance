import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { useSyncExternalStore } from 'react';
import { act, create } from 'react-test-renderer';
import { createLogNavigation } from '../src/lib/log-navigation.ts';
import { dateIdToEpochDay } from '../src/lib/dates.ts';
import { getNativePagerStatus, resetNativePagerStatus } from '../src/dev/native-pager-status.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = globalThis.__nativeWindowTest = { js: [], frames: new Map(), nextFrame: 0, width: 400, setPageCalls: [] };
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
      import React, { useRef, forwardRef, useImperativeHandle } from 'react';
      const NativePager = forwardRef((props, ref) => {
        useImperativeHandle(ref, () => ({
          setPageWithoutAnimation: index => globalThis.__nativeWindowTest.setPageCalls.push(index),
        }), []);
        return React.createElement('NativePager', props, props.children);
      });
      export default { createAnimatedComponent: () => NativePager };
      export const runOnUI = fn => (...args) => fn(...args);
      export const runOnJS = fn => (...args) => globalThis.__nativeWindowTest.js.push(() => fn(...args));
      export const useEvent = fn => fn;
      export const useSharedValue = value => { const ref = useRef({ value }); return ref.current; };
    `);
    return next(url, context);
  },
});
const { NativeDayWindow, NATIVE_WINDOW_RADIUS: C } = await import('../src/components/meal/native-day-window.tsx');
assert.equal(C, 30, 'RADIUS is 30 (61 container pages)');
const renderDay = dateId => React.createElement('Day', { dateId });
const flushJS = () => { for (const fn of state.js.splice(0)) fn(); };
const flushOneFrame = () => { for (const [id, fn] of [...state.frames]) { state.frames.delete(id); fn(); } };
const flushFrames = () => { while (state.frames.size > 0) flushOneFrame(); };
const pager = tree => tree.root.findByType('NativePager');
const selected = (p, index) => p.props.onPageSelected({ nativeEvent: { position: index } });
const phase = (p, value) => p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: value } });
const scroll = (p, index, offset) => p.props.onPageScroll({ eventName: 'onPageScroll', position: index, offset });
const mountedDates = tree => tree.root.findAllByType('Day').map(d => d.props.dateId);

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
  assert.deepEqual(
    mountedDates(tree),
    ['2026-11-06', '2026-11-07', '2026-11-08'],
    'initial commit mounts only the selected day and its two immediate neighbours'
  );
  await act(() => { selected(pager(tree), C); });
  assert.equal(tree.root.findAllByType('Day').length, 3, 'initial center acknowledgement does not prematurely expand beyond ±1');
  await act(() => { flushFrames(); });
  assert.equal(tree.root.findAllByType('Day').length, 9, 'idle preload caps at center ± 4 (9 days), never all 61 pages');
  return tree;
}

test('on first render only selected day and two neighbours mount; further days prepare one per idle frame up to 9 and never during a drag', async () => {
  const app = setup();
  let tree;
  try {
    await act(() => { tree = create(React.createElement(app.Host)); });
    const p = pager(tree);
    assert.equal(tree.root.findAllByType('Day').length, 3);
    await act(() => flushOneFrame());
    assert.equal(tree.root.findAllByType('Day').length, 4, 'prepares exactly one additional day per idle frame');
    await act(() => flushOneFrame());
    assert.equal(tree.root.findAllByType('Day').length, 5, 'prepares one more day on the next idle frame');
    await act(() => {
      phase(p, 'dragging');
      scroll(p, C, 0.25);
      flushJS();
      flushOneFrame();
      flushOneFrame();
    });
    assert.equal(tree.root.findAllByType('Day').length, 5, 'never runs idle preload during a drag and fast-paths when visible neighborhood is already prepared');
    await act(() => {
      phase(p, 'settling');
      flushOneFrame();
    });
    assert.equal(tree.root.findAllByType('Day').length, 5, 'never runs idle preload while settling');
    await act(() => {
      selected(p, C);
      phase(p, 'idle');
      flushJS();
    });
    await act(() => flushOneFrame());
    assert.equal(tree.root.findAllByType('Day').length, 6, 'resumes one-at-a-time preparation once idle');
    await act(() => flushFrames());
    assert.equal(tree.root.findAllByType('Day').length, 9, 'stops idle preload at 9 days (center ± 4)');
  } finally {
    if (tree) await act(() => tree.unmount());
  }
});

test('native scroll frames and selected events do not commit React or change the date before idle when neighborhood is prepared', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  const baseline = app.commits(), day = app.position.value;
  await act(() => {
    phase(p, 'dragging');
    for (let i = 0; i <= 200; i++) scroll(p, C, i / 200);
    flushJS();
    phase(p, 'settling'); selected(p, C + 1);
  });
  assert.equal(app.commits(), baseline, 'fast-path produces zero React commits when target ± 2 is already in preparedDays');
  assert.equal(app.nav.get(), '2026-11-07');
  assert.equal(app.position.value, day + 1);
  await act(() => { phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  assert.equal(pager(tree), p, 'ordinary acknowledgement never remounts/recenters the native pager');
  assert.equal(pager(tree).props.initialPage, C);
  await act(() => tree.unmount());
});

test('chained swipes without accepted idle immediately prepare target ± 2 before settling finishes while keeping date authority stable until final idle', async () => {
  const app = setup();
  let tree;
  try {
    await act(() => { tree = create(React.createElement(app.Host)); });
    const p = pager(tree);
    assert.deepEqual(mountedDates(tree), ['2026-11-06', '2026-11-07', '2026-11-08']);
    // Start swiping immediately before any idle preload frames run: C+1 -> C+2 -> C+3 -> C+4
    await act(() => {
      selected(p, C);
      phase(p, 'dragging'); scroll(p, C, 0.7); phase(p, 'settling'); selected(p, C + 1);
      // Intermediate idle arrives but is immediately invalidated by next drag before JS flushes
      phase(p, 'idle');
      phase(p, 'dragging'); scroll(p, C + 1, 0.8); phase(p, 'settling'); selected(p, C + 2);
      phase(p, 'dragging'); scroll(p, C + 2, 0.9); phase(p, 'settling'); selected(p, C + 3);
      phase(p, 'dragging'); scroll(p, C + 3, 0.9); phase(p, 'settling'); selected(p, C + 4);
    });
    // Even before any idle is accepted, target C + 4 ('2026-11-11') and its ±2 neighborhood ('2026-11-09'..'2026-11-13') are mounted!
    const mounted = mountedDates(tree);
    for (const expectedDate of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      assert.ok(mounted.includes(expectedDate), `expected ${expectedDate} to be prepared before idle`);
    }
    assert.ok(mounted.length <= 9, `hysteresis window stays bounded at <= 9 days (got ${mounted.length})`);
    assert.equal(app.nav.get(), '2026-11-07', 'global date authority has not changed before final idle');
    await act(() => { phase(p, 'idle'); flushJS(); });
    assert.equal(app.nav.get(), '2026-11-11', 'final idle commits the settled destination');
  } finally {
    if (tree) await act(() => tree.unmount());
  }
});

test('continuous drag across multiple pages prepares leading pages via discrete visible-pair changes while bounding retained pages to 9', async () => {
  const app = setup();
  let tree;
  try {
    await act(() => { tree = create(React.createElement(app.Host)); });
    const p = pager(tree);
    await act(() => { selected(p, C); });
    // Drag far to the right (visible pair C+5, C+6) while last selected is still C:
    // Protected union = [C-2..C+2] (5 days) U [C+4..C+7] (4 days) = 9 days total.
    await act(() => {
      phase(p, 'dragging');
      scroll(p, C + 5, 0.4);
      flushJS();
    });
    const duringDrag = mountedDates(tree);
    assert.equal(duringDrag.length, 9, 'bounds retained prepared days to 9 while protecting both target ± 2 and visible ± 1');
    assert.ok(duringDrag.includes('2026-11-13'), 'visible page C+6 is prepared');
    assert.ok(duringDrag.includes('2026-11-14'), 'leading page C+7 is prepared ahead of drag');
    // Settle on C+5 and let idle preload shift the window to center ± 4
    await act(() => {
      phase(p, 'settling');
      selected(p, C + 5);
      phase(p, 'idle');
      flushJS();
      flushFrames();
    });
    assert.equal(app.nav.get(), '2026-11-12');
    assert.equal(mountedDates(tree).length, 9, 'idle preload maintains 9 days around the new center (center ± 4)');
    assert.ok(mountedDates(tree).includes('2026-11-16'), 'center + 4 is preloaded on idle');
  } finally {
    if (tree) await act(() => tree.unmount());
  }
});

test('native swipes and immediate reversal retain recently visited pages within the 9-day hysteresis window without unmounting them', async () => {
  const app = setup();
  let tree;
  try {
    await act(() => { tree = create(React.createElement(app.Host)); });
    const p = pager(tree);
    assert.equal(tree.root.findAllByType('Day').length, 3, 'only immediate neighbors are prepared on first render');
    assert.equal(p.props.scrollEnabled, true, 'native swipe permission is already enabled before any layout callback');
    await act(() => selected(p, C));
    const day7Before = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-11-07');
    for (const [index, date] of [[C + 1, '2026-11-08'], [C + 2, '2026-11-09'], [C + 3, '2026-11-10'], [C + 1, '2026-11-08']]) {
      assert.equal(p.props.scrollEnabled, true);
      await act(() => {
        phase(p, 'dragging'); scroll(p, index, 0); flushJS(); selected(p, index); phase(p, 'idle'); flushJS();
      });
      assert.equal(app.nav.get(), date);
      assert.equal(pager(tree), p);
      assert.equal(p.props.scrollEnabled, true, 'acknowledgement never introduces a measured-neighbor lock');
    }
    const day7After = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-11-07');
    assert.equal(day7After, day7Before, 'hysteresis window retains 2026-11-07 across +3 swipe and reversal without unmounting');
    const revision = app.nav.getRevision();
    await act(() => { phase(p, 'dragging'); scroll(p, C + 1, .4); scroll(p, C + 1, 0); flushJS(); selected(p, C + 1); phase(p, 'idle'); flushJS(); });
    assert.equal(app.nav.getRevision(), revision, 'a canceled swipe does not commit another day');
    assert.equal(p.props.scrollEnabled, true);
  } finally { if (tree) await act(() => tree.unmount()); }
});

test('rapid native swipes discard a queued older idle callback and acknowledge only the final settled index', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => {
    for (const index of [C + 1, C + 2, C + 3]) {
      assert.equal(p.props.scrollEnabled, true, 'every rapid gesture is permitted without neighbor measurement or JS acknowledgement');
      phase(p, 'dragging'); scroll(p, index - 1, 0.6); phase(p, 'settling'); selected(p, index); phase(p, 'idle');
    }
  });
  assert.equal(app.nav.get(), '2026-11-07', 'date authority does not change until queued idle runs');
  assert.ok(mountedDates(tree).includes('2026-11-10'), 'final destination is already mounted before idle callback flushes');
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2026-11-10');
  assert.equal(p.props.scrollEnabled, true);
  assert.equal(pager(tree), p);
  await act(() => tree.unmount());
});

test('an own acknowledgement during the next native drag preserves presentation and updates its revision', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree), day = app.position.value;
  await act(() => {
    phase(p, 'dragging'); phase(p, 'settling'); selected(p, C + 1); phase(p, 'idle'); flushJS();
    phase(p, 'dragging'); scroll(p, C + 1, 0.3); flushJS();
  });
  assert.equal(app.nav.get(), '2026-11-08');
  assert.ok(Math.abs(app.position.value - day - 1.3) < 1e-9);
  assert.equal(app.interaction.value, 1);
  assert.equal(pager(tree), p);
  await act(() => { phase(p, 'settling'); selected(p, C + 2); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-09');
  await act(() => tree.unmount());
});

test('calendar jumps, blur/return and resize discard callbacks from old native surfaces', async () => {
  const app = setup(), tree = await mount(app), old = pager(tree);
  const oldProps = old.props;
  await act(() => { phase(old, 'dragging'); phase(old, 'settling'); selected(old, C + 1); phase(old, 'idle'); });
  await act(() => app.nav.set('2040-01-01'));
  assert.notEqual(pager(tree), old);
  assert.equal(tree.root.findAllByType('Day').length, 3);
  assert.equal(app.position.value, dateIdToEpochDay('2040-01-01'));
  await act(() => flushJS());
  assert.equal(app.nav.get(), '2040-01-01');
  const jumpedPager = pager(tree);
  const visibleDayBeforeBlur = tree.root.findAllByType('Day').find(d => d.props.dateId === '2040-01-01');
  await act(() => { phase(jumpedPager, 'dragging'); phase(jumpedPager, 'settling'); selected(jumpedPager, C + 1); phase(jumpedPager, 'idle'); });
  app.blur(); await act(() => tree.update(React.createElement(app.Host)));
  app.focus(); await act(() => tree.update(React.createElement(app.Host)));
  const visibleDayAfterFocus = tree.root.findAllByType('Day').find(d => d.props.dateId === '2040-01-01');
  assert.equal(visibleDayAfterFocus, visibleDayBeforeBlur, 'blur and focus keep the visible page mounted');
  await act(() => {
    oldProps.onPageScrollStateChanged({ nativeEvent: { pageScrollState: 'dragging' } });
    oldProps.onPageSelected({ nativeEvent: { position: C + 2 } });
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

test('crossing the window edge rebases only after settling without unmounting the visible page, preserves prepared days, and does not run unmount cleanup', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  resetNativePagerStatus();
  const edgeIndex = 56; // +26 days from 2026-11-07 => 2026-12-03
  state.setPageCalls.length = 0;
  await act(() => { phase(p, 'dragging'); phase(p, 'settling'); selected(p, edgeIndex); });
  const visibleBefore = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-12-03');
  const neighborBefore = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-12-02');
  assert.ok(visibleBefore, 'target edge day is prepared on selected before settling completes');
  assert.ok(neighborBefore, 'adjacent neighbor of edge day is prepared before settling completes');
  assert.equal(pager(tree), p);
  await act(() => { phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-12-03');
  assert.equal(pager(tree), p, 'window edge rebase preserves the mounted native pager');
  const visibleAfter = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-12-03');
  const neighborAfter = tree.root.findAllByType('Day').find(d => d.props.dateId === '2026-12-02');
  assert.equal(visibleAfter, visibleBefore, 'crossing the window edge does not unmount the visible page');
  assert.equal(neighborAfter, neighborBefore, 'crossing the window edge preserves adjacent prepared days by epochDay');
  assert.deepEqual(state.setPageCalls, [C], 'centers the native pager index without animation');
  assert.equal(app.position.value, dateIdToEpochDay('2026-12-03'));
  assert.equal(getNativePagerStatus().counts.unmount, 0, 'rebase must not trigger surface unmount cleanup');
  // Also verify that after a rebase with no native callback from setPageWithoutAnimation,
  // a stale oldIndex event is ignored, a queued handleVisiblePair from the old baseVersion is ignored,
  // UI->JS rebase filter clearing works, and subsequent selected -> idle without drag succeeds:
  await act(() => {
    // Stale pre-rebase index 56 event arriving late:
    selected(p, edgeIndex);
    scroll(p, edgeIndex, 0);
    flushJS();
  });
  assert.equal(app.position.value, dateIdToEpochDay('2026-12-03'), 'stale pre-rebase scroll frame is ignored');
  await act(() => {
    // Valid scroll frame near the new center clears the UI->JS rebase filter:
    scroll(p, C, 0.1);
    flushJS();
    // Subsequent selection without dragging (e.g. accessibility) + idle still works:
    selected(p, C + 1);
    phase(p, 'idle');
    flushJS();
  });
  assert.equal(app.nav.get(), '2026-12-04', 'navigation after rebase works without requiring a callback from setPageWithoutAnimation');
  await act(() => tree.unmount());
});

test('queued handleVisiblePair from an older baseVersion before rebase is ignored after rebase', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  const edgeIndex = 56;
  await act(() => {
    phase(p, 'dragging');
    // Trigger a visible-pair change that enqueues handleVisiblePair in state.js with baseVersion=0
    scroll(p, edgeIndex - 1, 0.5);
    // Before flushing that queued handleVisiblePair, settle on edgeIndex so rebase increments baseVersion to 1
    phase(p, 'settling');
    selected(p, edgeIndex);
    phase(p, 'idle');
    // Flush everything (reportIdle runs rebase -> baseVersion=1, and stale handleVisiblePair from baseVersion=0 is ignored)
    flushJS();
  });
  assert.equal(app.nav.get(), '2026-12-03');
  assert.ok(mountedDates(tree).includes('2026-12-03'));
  assert.ok(!mountedDates(tree).includes('2026-12-28'), 'stale visible-pair indices from old baseVersion are not applied to the new firstDay');
  await act(() => tree.unmount());
});

test('non-touch native accessibility paging settles without a dragging state', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { phase(p, 'settling'); selected(p, C + 1); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('Strict Mode effect cleanup and restoration leave native interaction enabled', async () => {
  const app = setup(); let tree;
  await act(() => { tree = create(React.createElement(React.StrictMode, null, React.createElement(app.Host))); });
  await act(() => { selected(pager(tree), C); flushFrames(); });
  const p = pager(tree);
  await act(() => { phase(p, 'dragging'); scroll(p, C, 0.5); phase(p, 'settling'); selected(p, C + 1); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('selection locks paging without remounting the native surface and rejects queued idle acknowledgements', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { phase(p, 'dragging'); phase(p, 'settling'); selected(p, C + 1); phase(p, 'idle'); });
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
  await act(() => { selected(p, C + 1); phase(p, 'dragging'); phase(p, 'settling'); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('selected plus idle can acknowledge a real page even when intermediate scroll states were omitted', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { selected(p, C + 1); phase(p, 'idle'); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('own acknowledgements and a reversal in the same native batch use the live revision before React props commit', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => {
    phase(p, 'dragging'); selected(p, C + 1); phase(p, 'idle'); flushJS();
    assert.equal(app.nav.get(), '2026-11-08');
    phase(p, 'dragging'); selected(p, C); phase(p, 'idle'); flushJS();
    assert.equal(app.nav.get(), '2026-11-07');
  });
  assert.equal(pager(tree), p);
  await act(() => {
    app.nav.set('2040-01-01');
    // Old native events cannot capture the new authority revision before the
    // calendar target has even committed/replaced their surface.
    phase(p, 'dragging'); selected(p, C + 1); phase(p, 'idle'); flushJS();
  });
  assert.equal(app.nav.get(), '2040-01-01');
  await act(() => tree.unmount());
});

test('a coalesced idle preceding selected in the same native batch still acknowledges the final page', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree);
  await act(() => { phase(p, 'idle'); selected(p, C + 1); flushJS(); });
  assert.equal(app.nav.get(), '2026-11-08');
  await act(() => tree.unmount());
});

test('an old idle acknowledgement does not pull back UI frames from a newer native gesture', async () => {
  const app = setup(), tree = await mount(app), p = pager(tree), base = app.position.value;
  await act(() => {
    phase(p, 'dragging'); selected(p, C + 1); phase(p, 'idle');
    // UI frames can already lead the next discrete JS callback.
    scroll(p, C + 1, 0.3); flushJS();
  });
  assert.equal(app.nav.get(), '2026-11-08');
  assert.ok(Math.abs(app.position.value - base - 1.3) < 1e-9);
  await act(() => tree.unmount());
});

test.after(() => {
  hooks.deregister(); delete globalThis.__nativeWindowTest;
  globalThis.requestAnimationFrame = originalRAF; globalThis.cancelAnimationFrame = originalCancel;
});
