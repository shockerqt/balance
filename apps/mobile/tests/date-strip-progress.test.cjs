const path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), babel = local('@babel/core'), ts = local('typescript');
const dates = local('./src/lib/dates.ts'), { createLogNavigation } = local('./src/lib/log-navigation.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const compiledFiles = new Map();
function compile(file, stubs) {
  const filename = path.join(root, 'src/components/meal', file);
  const compiled = compiledFiles.get(file) ?? babel.transformFileSync(filename, { babelrc: false, configFile: false, compact: false,
    presets: [['babel-preset-expo', {}]], caller: { name: 'metro', platform: 'android', isDev: false, isServer: false,
      bundler: 'metro', supportsStaticESM: true, supportsReactCompiler: true } }).code;
  compiledFiles.set(file, compiled);
  if (file.endsWith('.tsx')) assert.match(compiled, /react\/compiler-runtime/);
  const m = new Module(filename, module); m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; if (name.startsWith('@babel/runtime/') || name === 'react/compiler-runtime') return local(name); throw Error('Unexpected '+name); };
  m._compile(ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return m.exports;
}
function shared(initial) {
  let current = initial;
  return { pending: null, get value() { return current; }, set value(next) {
    if (next?.animation) { this.pending = next; next.owner = this; }
    else { current = next; this.pending = null; }
  } };
}
const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value ? [value] : [];
const style = node => Object.assign({}, ...flatten(node.props.style).map(s => s.read ? s.read() : s));
// Reconstruct the native centered transform's painted bounds, adding the 1dp
// pill border inset when measuring Face slots relative to the outer pill box.
function verticalBounds(node, borderInset = 0) {
  const s = style(node), baseTop = (s.top ?? 0) + borderInset, center = baseTop + s.height / 2;
  const point = y => [...(s.transform ?? [])].reverse().reduce((v, t) =>
    (v * (t.scaleY ?? t.scale ?? 1)) + (t.translateY ?? 0), y - center) + center;
  const top = point(baseTop), bottom = point(baseTop + s.height);
  return { top, bottom, center: (top + bottom) / 2, height: bottom - top };
}
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}
function fixedFaceLayout(faceNodes) {
  return faceNodes.map(n => {
    const s = style(n);
    return Object.fromEntries(Object.entries(s).filter(([key]) => /^(height|width|top|left|right|bottom|fontSize|lineHeight|padding.*)$/.test(key)));
  });
}
function faceNodes(button, active) {
  const activeView = button.findAllByType('AnimatedView').find(n => n.props.testID?.startsWith('day-active-'));
  if (active) {
    const texts = activeView.findAllByType('Text');
    const mark = activeView.findAllByType('View')[0];
    return { letter: texts[0], number: texts[1], mark };
  }
  const pillView = button.findAllByType('View')[0];
  const activeTexts = activeView ? new Set(activeView.findAllByType('Text')) : new Set();
  const texts = pillView.findAllByType('Text').filter(n => !activeTexts.has(n));
  const activeViews = activeView ? new Set(activeView.findAllByType('View')) : new Set();
  const mark = pillView.findAllByType('View').find(n => n !== pillView && !activeViews.has(n));
  return { letter: texts[0], number: texts[1], mark };
}
function assertStaticFaceSlots(nodes) {
  const ls = style(nodes.letter), ns = style(nodes.number), ms = style(nodes.mark);
  assert.equal(ls.height, 16);
  assert.equal(ls.lineHeight, 16);
  assert.equal(ls.transform, undefined);
  assert.equal(ns.fontSize, 17);
  assert.equal(ns.lineHeight, 20);
  assert.equal(ns.transform, undefined);
  assert.equal(ms.width, 18);
  assert.equal(ms.height, 4);
  assert.equal(ms.borderRadius, 2);
  assert.equal(ms.transform, undefined);
}
function assertWeekGeometry(weekNode, expectedHeight, expectedTop, expectedBottom) {
  const ws = style(weekNode);
  near(ws.height, expectedHeight, 'week height');
  near(ws.paddingTop, expectedTop, 'week paddingTop');
  near(ws.paddingBottom, expectedBottom, 'week paddingBottom');
}
async function harness(initial = '2026-12-06', staticMode = false, withCollapse = true) {
  const nav = createLogNavigation(initial), position = shared(dates.dateIdToEpochDay(initial)), interaction = shared(0), collapse = shared(0);
  let tree, commits = 0, active = true, compact = false, queued = [], animations = [], gestures = [], routes = [], reactions = [];
  const theme = { colors: { primary: '#00aa00', border: '#888888', surface: '#ffffff', background: '#fafafa', text: '#111111', textSecondary: '#444444', textMuted: '#666666', onPrimary: '#ffffff', barEmpty: '#dddddd' }, type: { label: {} } };
  const hooks = { logsDateStore: nav, useLogsDateRevision: () => React.useSyncExternalStore(nav.subscribe, nav.getRevision, nav.getRevision) };
  const reanimated = { __esModule: true, default: { View: 'AnimatedView', Text: 'Text', createAnimatedComponent: component => component },
    useSharedValue: initial => { const ref = React.useRef(null); return ref.current ??= shared(initial); },
    useAnimatedStyle: read => ({ read }), useDerivedValue: read => ({ get value() { return read(); } }),
    useAnimatedReaction: (read, react) => {
      const latest = React.useRef({ read, react }); latest.current = { read, react };
      React.useLayoutEffect(() => {
        const run = () => latest.current.react(latest.current.read()); reactions.push(run); run();
        return () => { reactions = reactions.filter(fn => fn !== run); };
      }, []);
    },
    interpolateColor: (value, input, output) => value === 0 ? output[0] : value === 1 ? output[1] : `blend:${value}`,
    cancelAnimation: value => { const p = value.pending; value.pending = null; p?.callback(false); },
    withTiming: (target, config, callback) => { const a = { animation: true, target, config, callback }; animations.push(a); return a; },
    runOnUI: fn => (...args) => fn(...args), runOnJS: fn => (...args) => queued.push(() => fn(...args)),
  };
  const gesturesModule = { GestureDetector: 'GestureDetector', Gesture: { Pan() {
    const g = { handlers: {} };
    for (const key of ['enabled', 'maxPointers', 'activeOffsetX', 'failOffsetY']) g[key] = () => g;
    for (const key of ['onBegin', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) g[key] = fn => { g.handlers[key] = fn; return g; };
    gestures.push(g); return g;
  } } };
  const common = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native-reanimated': reanimated,
    'react-native-gesture-handler': gesturesModule, '@/hooks/use-logs-date': hooks, '@/lib/dates': { ...dates, todayId: () => '2026-11-10' } };
  const swipe = compile('use-week-strip-swipe.ts', common);
  const { DateStripHeader } = compile('date-strip-header.tsx', { ...common,
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: x => x } },
    'expo-router': { useRouter: () => ({ push: route => routes.push(route) }) }, '@/theme': { useTheme: () => theme, font: { displaySmall: 'Display' } },
    '@/components/ui': { Icon: 'Icon', Text: 'Text' }, '@/hooks/use-meal-store': { useMealDay: () => ({ foods: [] }) }, './use-week-strip-swipe': swipe, './date-swipe': { DateSwipe: 'DateSwipe' },
  });
  function Host() {
    const date = React.useSyncExternalStore(nav.subscribe, nav.get, nav.get);
    React.useLayoutEffect(() => { position.value = dates.dateIdToEpochDay(date); }, [date]);
    return React.createElement(React.Profiler, { id: 'header', onRender: () => commits++ }, React.createElement(DateStripHeader, {
      compact, ...(withCollapse ? { collapseScroll: collapse } : {}), selectedDateId: date, onSelectDate: nav.set, onShiftDate: nav.shift, active,
      ...(staticMode ? {} : { pagerPosition: position, pagerInteraction: interaction }),
    }));
  }
  await renderer.act(async () => { tree = renderer.create(React.createElement(Host)); });
  const viewport = () => tree.root.findAllByType('AnimatedView').find(n => n.props.testID === 'week-viewport');
  const resize = async width => renderer.act(async () => viewport().props.onLayout({ nativeEvent: { layout: { width } } }));
  if (!staticMode) await resize(400);
  const buttons = () => tree.root.findAllByType('Button');
  const day = date => buttons().find(b => b.props.testID === 'day-'+date);
  const pill = date => day(date).findAllByType('AnimatedView').find(n => n.props.testID === 'day-active-'+dates.dateIdToEpochDay(date));
  const marker = pill;
  const heading = text => tree.root.findAllByType('AnimatedView').find(n => n.props.testID?.startsWith('date-label-expanded-') && n.findAllByType('Text').some(t => [t.props.children].flat().join('') === text));
  const weeks = () => tree.root.findAllByType('AnimatedView').filter(n => n.props.testID?.startsWith('week-layer-'));
  return { tree, nav, position, interaction, collapse, theme, routes, day, pill, marker, heading, weeks, viewport, style, resize,
    commits: () => commits,
    gesture: () => gestures.at(-1).handlers,
    async frames(values) { await renderer.act(async () => { for (const value of values) position.value = dates.dateIdToEpochDay(initial)+value; }); },
    async reactToPosition(value) { await renderer.act(async () => { position.value = dates.dateIdToEpochDay(initial)+value; for (const run of reactions) run(); }); },
    async moveContent(value) { await renderer.act(async () => { interaction.value = value; for (const run of reactions) run(); }); },
    async begin() { await renderer.act(async () => { const g = gestures.at(-1).handlers; g.onBegin(); g.onStart(); }); },
    async drag(x) { await renderer.act(async () => gestures.at(-1).handlers.onUpdate({ translationX: x })); },
    async end(x, velocity = 0, success = true) { await renderer.act(async () => gestures.at(-1).handlers.onEnd({ translationX: x, velocityX: velocity }, success)); },
    async finish() { await renderer.act(async () => { const a = animations.at(-1); a.owner.value = a.target; a.callback?.(true); }); },
    async flush() { await renderer.act(async () => { for (const f of queued.splice(0)) f(); }); },
    async collapseTo(value) { await renderer.act(async () => { collapse.value = value; }); },
    async compactMode(next) { compact = next; await renderer.act(async () => tree.update(React.createElement(Host))); },
    async jump(date) { await renderer.act(async () => nav.set(date)); },
    async blur() { active = false; await renderer.act(async () => tree.update(React.createElement(Host))); },
    async focus() { active = true; await renderer.act(async () => tree.update(React.createElement(Host))); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}

test('compiled header shares fractional title, border and underline progress without React commits or date writes', async () => {
  const h = await harness('2026-12-02');
  try {
    const baseline = h.commits();
    await h.frames([0.1, 0.2, 0.5]);
    assert.equal(h.style(h.heading('miércoles 2 de diciembre')).opacity, 0.5);
    assert.equal(h.style(h.heading('jueves 3 de diciembre')).opacity, 0.5);
    assert.equal(h.style(h.marker('2026-12-02')).opacity, 0.5);
    assert.equal(h.style(h.pill('2026-12-02')).opacity, 0.5);
    assert.equal(h.style(h.pill('2026-12-03')).opacity, 0.5);
    assert.equal(h.commits(), baseline); assert.equal(h.nav.get(), '2026-12-02');
    assert.equal(h.day('2026-12-02').props.accessibilityState.selected, true);
    await h.frames([0]);
    assert.equal(h.style(h.heading('miércoles 2 de diciembre')).opacity, 1);
    assert.equal(h.style(h.heading('jueves 3 de diciembre')).opacity, 0);
  } finally { await h.close(); }
});

test('Sunday to Monday and reverse reveal the actual adjacent weeks continuously, with no rebase jump', async () => {
  const h = await harness();
  try {
    await h.collapseTo(108);
    assert.ok(h.day('2026-11-30')); assert.ok(h.day('2026-12-07'));
    const baseline = h.commits();
    await h.frames([0.5]);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, -200);
    assert.equal(h.style(h.weeks()[2]).transform[0].translateX, 200);
    assert.equal(h.style(h.heading('domingo 6 de diciembre')).opacity, 0.5);
    assert.equal(h.style(h.heading('lunes 7 de diciembre')).opacity, 0.5);
    assert.equal(h.commits(), baseline);
    await h.jump('2026-12-07');
    await h.collapseTo(216);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, 0);
    await h.frames([0.5]);
    assert.equal(h.style(h.weeks()[0]).transform[0].translateX, -200);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, 200);
    assert.equal(h.nav.get(), '2026-12-07');
  } finally { await h.close(); }
});

test('week dragging follows the finger, previews the same weekday and commits only one seven-day command on completion', async () => {
  const h = await harness('2026-12-02');
  try {
    const baseline = h.commits(), original = h.position.value;
    await h.collapseTo(108);
    await h.begin(); await h.drag(-200);
    await h.collapseTo(54);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, -200);
    assert.equal(h.style(h.heading('miércoles 2 de diciembre')).opacity, 0.5);
    assert.equal(h.style(h.heading('miércoles 9 de diciembre')).opacity, 0.5);
    assert.equal(h.style(h.heading('jueves 3 de diciembre')).opacity, 0);
    assert.equal(h.style(h.marker('2026-12-09')).opacity, 0.5);
    assert.equal(h.commits(), baseline); assert.equal(h.nav.getRevision(), 0);
    assert.equal(h.position.value, original, 'week preview never writes the content pager position');
    await h.end(-200); assert.equal(h.nav.getRevision(), 0);
    await h.finish(); assert.equal(h.nav.getRevision(), 0, 'UI completion queues the guarded command');
    await h.flush(); assert.equal(h.nav.get(), '2026-12-09'); assert.equal(h.nav.getRevision(), 1);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, 0);
  } finally { await h.close(); }
});

test('short and cancelled week drags return; reversing selects the previous week', async () => {
  const h = await harness('2026-12-02');
  try {
    await h.collapseTo(108);
    await h.begin(); await h.drag(-20); await h.end(-20); await h.finish(); await h.flush();
    assert.equal(h.nav.getRevision(), 0);
    await h.begin(); await h.drag(-240);
    await renderer.act(async () => h.gesture().onFinalize());
    await h.finish(); await h.flush(); assert.equal(h.nav.getRevision(), 0);
    await h.begin(); await h.drag(-200); await h.drag(200); await h.end(200); await h.finish(); await h.flush();
    assert.equal(h.nav.get(), '2026-11-25');
  } finally { await h.close(); }
});

test('calendar commands, away/back revisions, resize, blur and new gestures invalidate queued weekly completions', async () => {
  for (const invalidation of ['calendar', 'away-back', 'resize', 'blur', 'new-gesture', 'content-gesture', 'unmount']) {
    const h = await harness('2026-12-02'); let closed = false;
    try {
      await h.collapseTo(108);
      await h.begin(); await h.drag(-220); await h.end(-220); await h.finish();
      if (invalidation === 'calendar') await h.jump('2040-01-01');
      if (invalidation === 'away-back') { await h.jump('2040-01-01'); await h.jump('2026-12-02'); }
      if (invalidation === 'resize') await h.resize(500);
      if (invalidation === 'blur') { await h.blur(); await h.focus(); }
      if (invalidation === 'new-gesture') await h.begin();
      if (invalidation === 'content-gesture') { await h.moveContent(1); await h.moveContent(0); }
      if (invalidation === 'unmount') { await h.close(); closed = true; }
      const expected = h.nav.get(), revision = h.nav.getRevision();
      await h.flush(); assert.equal(h.nav.get(), expected, invalidation); assert.equal(h.nav.getRevision(), revision, invalidation);
    } finally { if (!closed) await h.close(); }
  }
});

test('week gestures cannot override a moving content pager; taps, arrows and calendar remain direct commands', async () => {
  const h = await harness('2026-12-02');
  try {
    h.interaction.value = 1;
    await h.begin(); await h.drag(-220); await h.end(-220); await h.flush();
    assert.equal(h.nav.getRevision(), 0);
    h.interaction.value = 0;
    await renderer.act(async () => h.day('2026-12-05').props.onPress());
    assert.equal(h.nav.get(), '2026-12-05');
    const title = h.tree.root.findAll(n => n.props.accessibilityRole === 'adjustable')[0];
    await renderer.act(async () => title.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    assert.equal(h.nav.get(), '2026-12-06');
    await renderer.act(async () => title.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    assert.equal(h.nav.get(), '2026-11-10');
    await renderer.act(async () => h.nav.set('2026-12-06'));
    await renderer.act(async () => h.tree.root.findAllByType('Button').find(b => b.props.accessibilityLabel === 'Elegir fecha').props.onPress());
    assert.deepEqual(h.routes, ['/date-picker']);
    assert.equal(h.tree.root.findAllByType('AnimatedView').filter(n => n.props.testID?.startsWith('date-label-expanded-')).length, 15);
    assert.equal(h.weeks().length, 3);
    assert.equal(h.weeks().filter(w => !w.props.accessibilityElementsHidden).length, 1);
  } finally { await h.close(); }
});

test('a new week drag interrupts the pending animation from its current progress and invalidates its old completion', async () => {
  const h = await harness('2026-12-02');
  try {
    await h.begin(); await h.drag(-200); await h.end(-200);
    const baseline = h.commits();
    await h.begin();
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, -200);
    await h.drag(400);
    assert.equal(h.style(h.weeks()[1]).transform[0].translateX, 200);
    assert.equal(h.commits(), baseline);
    await h.end(400); await h.finish(); await h.flush();
    assert.equal(h.nav.get(), '2026-11-25'); assert.equal(h.nav.getRevision(), 1);
  } finally { await h.close(); }
});

test('consumers without a pager retain a selected pill and discrete weekly navigation', async () => {
  const h = await harness('2026-12-02', true);
  try {
    assert.equal(h.tree.root.findByType('DateSwipe').props.days, 7);
    assert.equal(h.tree.root.findAllByType('AnimatedView').filter(n => n.props.testID?.startsWith('date-label-')).length, 0);
    assert.equal(h.day('2026-12-02').props.accessibilityState.selected, true);
    await renderer.act(async () => h.day('2026-12-04').props.onPress());
    assert.equal(h.nav.get(), '2026-12-04');
  } finally { await h.close(); }
});

test('collapse shares UI progress with date paging, morphs week geometry and keeps one accessible calendar', async () => {
  const h = await harness('2026-12-02');
  const calendars = () => h.tree.root.findAllByType('Button').filter(n => n.props.accessibilityLabel === 'Elegir fecha' && n.props.accessible);
  const layer = kind => h.tree.root.findAllByType('AnimatedView').find(n => n.props.testID === `date-label-${kind}-2026-12-02`);
  try {
    assert.equal(calendars().length, 1);
    const baseline = h.commits();
    await h.collapseTo(54);
    assert.equal(h.style(h.day('2026-12-02')).flex, 1);
    assert.equal(h.style(h.viewport()).height, 64.5);
    assertWeekGeometry(h.weeks()[1], 64.5, 3.5, 7);
    await h.frames([0.5]);
    assert.equal(h.style(layer('expanded')).opacity, 0.5);
    assert.equal(h.style(layer('compact')).opacity, 0.5);
    assert.equal(h.commits(), baseline, 'UI-only scroll and pager frames do not commit React');
    assert.equal(h.nav.get(), '2026-12-02');
    await h.collapseTo(216); await h.compactMode(true);
    assert.equal(calendars().length, 1);
    assert.equal(h.style(calendars()[0]).width, 44); assert.equal(h.style(calendars()[0]).height, 28);
    assertWeekGeometry(h.weeks()[1], 42, 2, 4);
    const title = layer('compact').findAllByType('Text')[0];
    assert.equal([title.props.children].flat().join(''), 'Miércoles · 2 dic');
    assert.equal(h.style(title).fontFamily, 'Display');
    await h.jump('2026-12-03');
    const active = h.tree.root.findAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessible);
    assert.equal(active.length, 1); assert.match(active[0].props.accessibilityLabel, /jueves 3 de diciembre/);
    await renderer.act(async () => calendars()[0].props.onPress());
    assert.deepEqual(h.routes, ['/date-picker']);
  } finally { await h.close(); }
});

test('compiled global title restores the historical fade timing inside its fixed clip', async () => {
  const h = await harness('2026-12-02');
  const face = kind => {
    let node = h.tree.root.findAllByType('AnimatedView').find(n => n.props.testID === `date-label-${kind}-2026-12-02`).parent;
    while (node && node.props.accessibilityElementsHidden === undefined) node = node.parent;
    return node;
  };
  try {
    const baseline = h.commits();
    for (const offset of [-20, 0, 54, 90.72, 108, 125.28, 162, 216, 300]) {
      await h.collapseTo(offset);
      const p = Math.min(1, Math.max(0, offset / 216));
      const expanded = h.style(face('expanded')), compact = h.style(face('compact'));
      assert.ok(Math.abs(expanded.opacity - Math.max(0, 1 - p / .42)) < 1e-12);
      assert.ok(Math.abs(compact.opacity - Math.min(1, Math.max(0, (p - .58) / .42))) < 1e-12);
      if (p >= .42 && p <= .58) {
        assert.ok(expanded.opacity < 1e-12);
        assert.ok(compact.opacity < 1e-12, 'the familiar baseline retains its historical blank interval');
      }
      assert.equal(expanded.transform[0].translateY, -28 * p);
      const clip = face('expanded').parent;
      assert.equal(h.style(clip).overflow, 'hidden');
      assert.equal(h.style(clip).height, 64 - 28 * p);
    }
    assert.equal(h.commits(), baseline, 'collapse remains on the UI thread between semantic handoffs');
    await h.compactMode(true);
    assert.equal(face('expanded').props.accessibilityElementsHidden, true);
    assert.equal(face('compact').props.accessibilityElementsHidden, false);
    assert.equal(h.tree.root.findAllByType('Button').filter(n => n.props.accessibilityLabel === 'Elegir fecha' && n.props.accessible).length, 1);
  } finally { await h.close(); }
});

test('single-view bottom-anchored pills avoid PillSurface inflation, keep static DayFace slots, and gate offscreen weeks during vertical collapse', async () => {
  const h = await harness('2026-12-02');
  try {
    assert.equal(h.tree.root.findAll(n => n.props.testID?.startsWith('pill-cap-')).length, 0, 'no 3-view PillSurface');
    assert.equal(h.tree.root.findAll(n => n.props.testID?.startsWith('day-cell-')).length, 0, 'no extra dayCell wrapper');
    const allDays = h.tree.root.findAllByType('Button').filter(n => n.props.testID?.startsWith('day-'));
    assert.equal(allDays.length, 21);
    for (const btn of allDays) {
      assert.equal(h.style(btn).flex, 1);
      const pillView = btn.findAllByType('View')[0];
      const ps = h.style(pillView);
      assert.equal(ps.borderRadius, 14);
      assert.equal(ps.borderWidth, 1);
      assert.equal(ps.justifyContent, 'flex-end');
      assert.equal(ps.overflow, 'hidden');
      assertStaticFaceSlots(faceNodes(btn, false));
      assertStaticFaceSlots(faceNodes(btn, true));
    }
    const faceSnapshot = () => allDays.flatMap(btn => [
      ...fixedFaceLayout(Object.values(faceNodes(btn, false))),
      ...fixedFaceLayout(Object.values(faceNodes(btn, true))),
    ]);
    const initialFaceLayouts = faceSnapshot();
    const commits = h.commits(), revision = h.nav.getRevision();

    // Forward vertical scroll: mid-collapse updates only the center week (57dp) and holds offscreen weeks at p=0 (72dp).
    await h.collapseTo(108);
    assert.equal(h.style(h.viewport()).height, 57);
    assertWeekGeometry(h.weeks()[1], 57, 3, 6);
    assertWeekGeometry(h.weeks()[0], 72, 4, 8);
    assertWeekGeometry(h.weeks()[2], 72, 4, 8);

    // Endpoints and overscroll sync both visible and deferred week presentations.
    for (const offset of [216, 300, 216]) {
      await h.collapseTo(offset);
      assert.equal(h.style(h.viewport()).height, 42);
      for (const week of h.weeks()) {
        assertWeekGeometry(week, 42, 2, 4);
      }
    }

    // Reverse vertical scroll: mid-collapse keeps deferred offscreen weeks at compact (42dp) until offset=0.
    await h.collapseTo(108);
    assertWeekGeometry(h.weeks()[1], 57, 3, 6);
    assertWeekGeometry(h.weeks()[0], 42, 2, 4);
    assertWeekGeometry(h.weeks()[2], 42, 2, 4);

    for (const offset of [0, -20]) {
      await h.collapseTo(offset);
      assert.equal(h.style(h.viewport()).height, 72);
      for (const week of h.weeks()) {
        assertWeekGeometry(week, 72, 4, 8);
      }
    }

    assert.deepEqual(faceSnapshot(), initialFaceLayouts, 'no repeated fontSize, height or padding changes inside DayFace');
    assert.equal(h.commits(), commits); assert.equal(h.nav.getRevision(), revision);
  } finally { await h.close(); }
});

test('horizontal gestures immediately synchronize pDeferred to pVisible on the same frame', async () => {
  const assertAllSyncedToMiddle = h => {
    for (const week of h.weeks()) {
      assertWeekGeometry(week, 57, 3, 6);
    }
  };

  // 1. weekPhase + weekOffset via week drag
  {
    const h = await harness('2026-12-02');
    try {
      await h.collapseTo(108);
      assertWeekGeometry(h.weeks()[0], 72, 4, 8);
      await h.begin();
      assertAllSyncedToMiddle(h);
      await h.drag(-120);
      assertAllSyncedToMiddle(h);
      await h.end(0); await h.finish();
      // Remains synced at 0.5 after settling back to center
      assertAllSyncedToMiddle(h);
    } finally { await h.close(); }
  }

  // 2. position !== selectedDay via pager swipe
  {
    const h = await harness('2026-12-02');
    try {
      await h.collapseTo(108);
      assertWeekGeometry(h.weeks()[0], 72, 4, 8);
      await h.frames([0.25]);
      assertAllSyncedToMiddle(h);
    } finally { await h.close(); }
  }

  // 3. pagerInteraction !== 0 even before position moves
  {
    const h = await harness('2026-12-02');
    try {
      await h.collapseTo(108);
      assertWeekGeometry(h.weeks()[0], 72, 4, 8);
      await h.moveContent(1);
      assertAllSyncedToMiddle(h);
    } finally { await h.close(); }
  }
});

test('Reanimated valueSetter gating runs 5 strip style mappers mid-collapse and 0 mappers in compact/overscroll', async () => {
  // Model Reanimated 4.5.1 Topological MapperRegistry + valueSetter equality check.
  const nav = createLogNavigation('2026-12-02');
  const makeReactive = initial => {
    let val = initial;
    const node = {
      listeners: new Set(),
      get value() { return val; },
      set value(next) {
        if (val === next) return; // valueSetter short-circuit
        val = next;
        for (const fn of [...node.listeners]) fn();
      },
    };
    return node;
  };
  const position = makeReactive(dates.dateIdToEpochDay('2026-12-02'));
  const interaction = makeReactive(0);
  const collapse = makeReactive(0);
  let styleEvaluations = 0, transformAllocs = 0;
  const allNodes = [collapse, position, interaction];
  const withTracking = fn => {
    const deps = new Set();
    const hooked = [];
    for (const s of allNodes) {
      const desc = Object.getOwnPropertyDescriptor(s, 'value');
      const origGet = desc.get;
      Object.defineProperty(s, 'value', {
        configurable: true,
        get() { deps.add(s); return origGet.call(this); },
        set(v) { desc.set.call(this, v); },
      });
      hooked.push([s, desc]);
    }
    const result = fn();
    for (const [s, desc] of hooked) Object.defineProperty(s, 'value', desc);
    return { deps, result };
  };
  const reanimated = {
    __esModule: true,
    default: { View: 'AnimatedView', Text: 'Text', createAnimatedComponent: c => c },
    useSharedValue: initial => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const node = makeReactive(initial);
        allNodes.push(node);
        ref.current = node;
      }
      return ref.current;
    },
    useDerivedValue: read => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const { deps, result } = withTracking(read);
        const out = makeReactive(result);
        let running = false;
        const run = () => {
          if (running) return;
          running = true;
          try { out.value = read(); } finally { running = false; }
        };
        for (const d of deps) d.listeners.add(run);
        allNodes.push(out);
        ref.current = out;
      }
      return ref.current;
    },
    useAnimatedStyle: read => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const { deps, result } = withTracking(read);
        const entry = { read, deps, runs: 0, last: result };
        for (const d of deps) d.listeners.add(() => {
          entry.runs++;
          styleEvaluations++;
          const next = read();
          if (Array.isArray(next.transform)) transformAllocs++;
          entry.last = next;
        });
        ref.current = entry;
      }
      return ref.current;
    },
    useAnimatedReaction: () => {},
    cancelAnimation: () => {},
    withTiming: target => ({ animation: true, target }),
    runOnUI: fn => (...args) => fn(...args),
    runOnJS: fn => fn,
  };

  const common = { react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native-reanimated': reanimated,
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', Gesture: { Pan() { const g = {}; for (const k of ['enabled','maxPointers','activeOffsetX','failOffsetY','onBegin','onStart','onUpdate','onEnd','onFinalize']) g[k] = () => g; return g; } } },
    '@/hooks/use-logs-date': { logsDateStore: nav, useLogsDateRevision: () => 0 }, '@/lib/dates': { ...dates, todayId: () => '2026-11-10' } };
  const swipe = compile('use-week-strip-swipe.ts', common);
  const { DateStripHeader } = compile('date-strip-header.tsx', { ...common,
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: x => x } },
    'expo-router': { useRouter: () => ({ push() {} }) }, '@/theme': { useTheme: () => ({ colors: { primary: '#0a0', border: '#888', surface: '#fff', background: '#fafafa', text: '#111', textSecondary: '#444', textMuted: '#666', onPrimary: '#fff', barEmpty: '#ddd' }, type: { label: {} } }), font: { displaySmall: 'Display' } },
    '@/components/ui': { Icon: 'Icon', Text: 'Text' }, '@/hooks/use-meal-store': { useMealDay: () => ({ foods: [] }) }, './use-week-strip-swipe': swipe, './date-swipe': { DateSwipe: 'DateSwipe' },
  });

  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(DateStripHeader, {
      collapseScroll: collapse, selectedDateId: '2026-12-02', onSelectDate: nav.set, onShiftDate: nav.shift,
      pagerPosition: position, pagerInteraction: interaction, active: true,
    }));
  });
  try {
    // Mid-collapse vertical scroll frame: 0 -> 108
    styleEvaluations = 0; transformAllocs = 0;
    await renderer.act(async () => { collapse.value = 108; });
    // Only 4 header-level styles (titleHeight, fullTitle, compactTitle, weekHeight) + 1 collapseVisible.week style run; collapseDeferred.week runs 0 times!
    assert.equal(styleEvaluations, 5, 'only 4 header + 1 visible week style mapper run; deferred week mapper runs 0 times');

    // Reach compact endpoint: 108 -> 216 (syncs both visible and deferred)
    await renderer.act(async () => { collapse.value = 216; });

    // Scrolling further in compact mode (216 -> 250 -> 300) triggers ZERO style mappers and ZERO transform allocations
    styleEvaluations = 0; transformAllocs = 0;
    await renderer.act(async () => { collapse.value = 250; collapse.value = 300; });
    assert.equal(styleEvaluations, 0, 'zero style mappers run when scrolling past 216dp');
    assert.equal(transformAllocs, 0, 'zero transform array allocations when scrolling past 216dp');

    // Overscrolling below 0 triggers ZERO style mappers
    await renderer.act(async () => { collapse.value = 0; });
    styleEvaluations = 0; transformAllocs = 0;
    await renderer.act(async () => { collapse.value = -20; collapse.value = -60; });
    assert.equal(styleEvaluations, 0, 'zero style mappers run when overscrolling below 0dp');
    assert.equal(transformAllocs, 0);
  } finally {
    await renderer.act(async () => tree.unmount());
  }
});

test('nested collapse and horizontal paging compose through drag reversal, cancellation and resize', async () => {
  const h = await harness();
  try {
    const commits = h.commits();
    await h.collapseTo(108); await h.frames([0.5]);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -200 }]);
    assert.equal(h.style(h.weeks()[1]).paddingTop, 3);
    assert.equal(h.style(h.weeks()[1]).height, 57);
    await h.frames([0]); await h.begin(); await h.drag(-160);
    await h.collapseTo(216);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -160 }]);
    assert.equal(h.style(h.weeks()[1]).paddingTop, 2);
    assert.equal(h.style(h.weeks()[1]).height, 42);
    await h.drag(80); await h.collapseTo(108);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: 80 }]);
    assert.equal(h.style(h.weeks()[1]).paddingTop, 3);
    assert.equal(h.style(h.weeks()[1]).height, 57);
    await renderer.act(async () => h.gesture().onFinalize());
    await h.finish(); await h.flush(); assert.equal(h.nav.getRevision(), 0);
    await h.resize(500); await h.frames([0.5]);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -250 }]);
    assert.equal(h.style(h.weeks()[1]).paddingTop, 3);
    assert.equal(h.commits(), commits); assert.equal(h.nav.getRevision(), 0);
  } finally { await h.close(); }
});

test('face siblings preserve a single selected day command and hide adjacent weeks from accessibility', async () => {
  const h = await harness('2026-12-02');
  try {
    for (const offset of [0, 108, 216, 108, 0]) {
      await h.collapseTo(offset);
      const days = h.tree.root.findAllByType('Button').filter(n => n.props.testID?.startsWith('day-'));
      assert.equal(days.length, 21); assert.equal(new Set(days.map(n => n.props.testID)).size, 21);
      assert.equal(days.filter(n => n.props.accessibilityState.selected).length, 1);
      assert.match(h.day('2026-12-02').props.accessibilityLabel, /Miércoles 2 de diciembre/);
      const exposed = days.filter(n => {
        for (let parent = n.parent; parent; parent = parent.parent) {
          if (parent.props.accessibilityElementsHidden || parent.props.importantForAccessibility === 'no-hide-descendants') return false;
        }
        return true;
      });
      assert.equal(exposed.length, 7);
      assert.ok(exposed.every(n => n.props.accessibilityRole === 'button'));
    }
    await renderer.act(async () => h.day('2026-12-03').props.onPress());
    assert.equal(h.nav.getRevision(), 1); assert.equal(h.nav.get(), '2026-12-03');
    assert.equal(h.day('2026-12-03').props.accessibilityState.selected, true);
  } finally { await h.close(); }
});

test('non-pager and compact-only fallbacks use the same fixed face and clipped viewport', async () => {
  for (const withCollapse of [true, false]) {
    const h = await harness('2026-12-02', true, withCollapse);
    try {
      assert.equal(h.tree.root.findAllByType('GestureDetector').length, 0);
      assert.equal(h.tree.root.findByType('DateSwipe').props.days, 7);
      assert.equal(h.style(h.viewport()).height, 72);
      const fallbackRow = h.viewport().findAllByType('AnimatedView').find(n => n !== h.viewport());
      assertWeekGeometry(fallbackRow, 72, 4, 8);
      assertStaticFaceSlots(faceNodes(h.day('2026-12-02'), false));
      if (withCollapse) {
        await h.collapseTo(108);
        assert.equal(h.style(h.viewport()).height, 57);
        assertWeekGeometry(fallbackRow, 57, 3, 6);
        assertStaticFaceSlots(faceNodes(h.day('2026-12-02'), false));
        await h.collapseTo(216);
      }
      await h.compactMode(true);
      assert.equal(h.style(h.viewport()).height, 42);
      assertWeekGeometry(fallbackRow, 42, 2, 4);
      assertStaticFaceSlots(faceNodes(h.day('2026-12-02'), false));
      const calendar = h.tree.root.findAllByType('Button').filter(n => n.props.accessibilityLabel === 'Elegir fecha' && n.props.accessible);
      assert.equal(calendar.length, 1);
      await renderer.act(async () => calendar[0].props.onPress()); assert.deepEqual(h.routes, ['/date-picker']);
      await renderer.act(async () => h.day('2026-12-04').props.onPress());
      assert.equal(h.nav.get(), '2026-12-04');
    } finally { await h.close(); }
  }
});


test('bounded header windows follow chained pager travel without confirming dates', async () => {
  const initial = '2026-12-28', h = await harness(initial);
  try {
    await h.moveContent(1);
    for (const offset of [...Array.from({ length: 30 }, (_, i) => i + 1), ...Array.from({ length: 60 }, (_, i) => 29 - i)]) {
      await h.reactToPosition(offset); await h.flush();
      const date = dates.shiftDateId(initial, offset);
      const labels = h.tree.root.findAllByType('AnimatedView').filter(n => n.props.testID?.startsWith('date-label-expanded-'));
      assert.equal(labels.length, 15);
      assert.equal(h.style(labels.find(n => n.props.testID === 'date-label-expanded-'+date)).opacity, 1);
      const week = h.weeks().find(n => h.style(n).transform[0].translateX === 0);
      assert.ok(week, 'a rendered week remains in the viewport');
      assert.ok(week.findAllByType('Button').some(n => n.props.testID === 'day-'+date));
      assert.equal(h.weeks().length, 3);
      assert.equal(h.nav.get(), initial); assert.equal(h.nav.getRevision(), 0);
    }
    const commits = h.commits();
    for (const offset of [-30.1, -30.2, -30.5]) { await h.reactToPosition(offset); await h.flush(); }
    assert.equal(h.commits(), commits, 'fractional frames within headroom do not commit React');
    const labels = h.tree.root.findAllByType('AnimatedView');
    assert.equal(h.style(labels.find(n => n.props.testID === 'date-label-expanded-'+dates.shiftDateId(initial, -30))).opacity, 0.5);
  } finally { await h.close(); }
});

test('queued visual window updates use current position and reject external jumps, blur and unmount', async () => {
  const h = await harness('2026-12-28');
  try {
    await h.reactToPosition(4);
    await h.frames([20]); await h.flush();
    assert.ok(h.day('2027-01-17'));
    await h.reactToPosition(24);
    await h.jump('2025-02-03'); await h.flush();
    assert.ok(h.day('2025-02-03')); assert.equal(h.nav.getRevision(), 1);
    await h.jump('2026-12-28'); await h.flush();
    assert.ok(h.day('2026-12-28'), 'returning to an earlier canonical date does not revive its old visual anchor');
    const commits = h.commits();
    await h.reactToPosition(8); await h.blur(); await h.flush();
    assert.equal(h.commits(), commits + 1, 'blur rejects the queued reanchor');
    await h.focus(); await h.reactToPosition(12); await h.close(); await h.flush();
  } finally { if (h.tree.toJSON() !== null) await h.close(); }
});
