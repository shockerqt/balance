const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const dates = local('./src/lib/dates.ts'), { createLogNavigation } = local('./src/lib/log-navigation.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const compile = (filename, stubs) => {
  const m = new Module(filename, module); m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; throw Error('Unexpected dependency ' + name); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
  return m.exports;
};
const native = { Platform: { OS: 'android' }, Keyboard: { dismiss() {} }, I18nManager: { isRTL: false },
  View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 400 }) };
// Execute the installed PagerView class, including its nativeEvent callback
// forwarding. Only the host view/commands and unrelated child styling are mocked.
const { PagerView } = compile(path.join(root, 'node_modules/react-native-pager-view/src/PagerView.tsx'), {
  react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': native,
  './utils': { childrenWithOverriddenStyle: children => children },
  './PagerViewNativeComponent': { __esModule: true, default: 'PagerHost', Commands: {} },
});
let queued = [], frames = [], commits = 0;
const reanimated = {
  __esModule: true,
  default: { createAnimatedComponent: Component => function Animated(props) {
    const forwarded = {}, worklets = {};
    for (const [key, value] of Object.entries(props)) {
      if (value?.testWorklet) {
        // Match Reanimated's native PropsFilter seam: a worklet handler becomes
        // a dummy JS listener. Discrete date updates must use real JS callbacks.
        forwarded[key] = () => {};
        worklets[key] = event => value.testWorklet({ eventName: key, ...event });
      } else forwarded[key] = value;
    }
    return React.createElement(Component, { ...forwarded, testWorklets: worklets });
  } },
  useSharedValue: value => React.useRef({ value }).current,
  useAnimatedRef: () => React.useRef(null), useAnimatedProps: read => ({ read }), useFrameCallback() {}, dispatchCommand() {},
  useEvent: handler => ({ testWorklet: handler }),
  runOnUI: fn => (...args) => fn(...args),
  runOnJS: fn => (...args) => queued.push(() => fn(...args)),
};
const { NativeDayWindow } = compile(path.join(root, 'src/components/meal/native-day-window.tsx'), {
  react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': native,
  'react-native-pager-view': { __esModule: true, default: PagerView },
  'react-native-reanimated': reanimated, '../../lib/dates': dates,
  '../../dev/native-pager-status': local('./src/dev/native-pager-status.ts'),
  '../../lib/diary-presentation': local('./src/lib/diary-presentation.ts'),
});

test('installed PagerView callback forwarding keeps visible day, header/week and authority synchronized without JS scroll-frame handlers', async () => {
  const raf = global.requestAnimationFrame, cancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  global.cancelAnimationFrame = () => {};
  const nav = createLogNavigation('2026-11-08'); // Sunday -> Monday crosses the week boundary.
  const position = { value: dates.dateIdToEpochDay(nav.get()) }, interaction = { value: 0 };
  const renderDay = dateId => React.createElement('Day', { dateId });
  let tree;
  function Host() {
    const date = React.useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    return React.createElement(React.Profiler, { id: 'host', onRender: () => commits++ },
      React.createElement(React.Fragment, null,
        React.createElement('Header', { date, week: dates.getMondayDateId(date) }),
        React.createElement(NativeDayWindow, { dateId: date, revision: nav.getRevision(), readRevision: nav.getRevision, position, interaction, renderDay,
          onSettle: (next, expected) => { if (expected !== nav.getRevision()) return; nav.set(next); return nav.getRevision(); } })));
  }
  const selected = (p, index) => { p.props.testWorklets.onPageScroll({ eventName:'onPageSelected', position:index }); p.props.onPageSelected({ nativeEvent: { position: index } }); };
  const phase = (p, value) => { p.props.testWorklets.onPageScroll({ eventName:'onPageScrollStateChanged', pageScrollState:value }); p.props.onPageScrollStateChanged({ nativeEvent: { pageScrollState: value } }); };
  const flush = () => { for (const fn of queued.splice(0)) fn(); };
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); });
    let p = tree.root.findByType('PagerHost');
    await renderer.act(async () => { selected(p, 7); for (const fn of frames.splice(0)) fn(); });
    const baseline = commits;
    await renderer.act(async () => {
      selected(p, 8); // Page selection before the scrolling-state callback.
      phase(p, 'dragging');
      for (let i = 0; i <= 200; i++) p.props.testWorklets.onPageScroll({ position: 7, offset: i / 200 });
      phase(p, 'settling');
    });
    assert.equal(commits, baseline, 'native frame/selection/state receipt cannot render React');
    assert.equal(nav.get(), '2026-11-08', 'selection alone cannot change the authority');
    assert.equal(position.value, dates.dateIdToEpochDay('2026-11-09'));
    await renderer.act(async () => { phase(p, 'idle'); flush(); });
    assert.equal(tree.root.findByType('Header').props.date, '2026-11-09');
    assert.equal(tree.root.findByType('Header').props.week, '2026-11-09');
    assert.equal(tree.root.findByType('PagerHost'), p, 'own acknowledgement preserves the native surface');
    const next = tree.root.findByType('PagerHost');
    await renderer.act(async () => { selected(next, 9); phase(next, 'idle'); flush(); });
    assert.equal(nav.get(), '2026-11-10', 'missing intermediate states cannot strand the header');
    await renderer.act(async () => { phase(next, 'idle'); selected(next, 10); flush(); });
    assert.equal(tree.root.findByType('Header').props.date, '2026-11-11', 'coalesced idle before selection must use the final batch selection');
    assert.equal(position.value, dates.dateIdToEpochDay('2026-11-11'), 'the week marker must finish on that same date');
  } finally {
    if (tree) await renderer.act(async () => tree.unmount());
    global.requestAnimationFrame = raf; global.cancelAnimationFrame = cancel;
    queued = []; frames = [];
  }
});
