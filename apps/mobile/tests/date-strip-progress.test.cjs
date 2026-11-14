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
// Reconstruct the native centered transform's painted bounds, independently of
// the component's collapse metrics. Translation and scale compose right to left.
function verticalBounds(node) {
  const s = style(node), center = (s.top ?? 0) + s.height / 2;
  const point = y => [...(s.transform ?? [])].reverse().reduce((v, t) =>
    (v * (t.scaleY ?? t.scale ?? 1)) + (t.translateY ?? 0), y - center) + center;
  const top = point(s.top ?? 0), bottom = point((s.top ?? 0) + s.height);
  return { top, bottom, center: (top + bottom) / 2, height: bottom - top };
}
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}
function fixedLayout(node) {
  return node.findAll(n => typeof n.type === 'string' && n.props.style).map(n => {
    const s = style(n);
    return Object.fromEntries(Object.entries(s).filter(([key]) => /^(height|width|top|left|right|bottom|fontSize|lineHeight|padding.*)$/.test(key)));
  });
}
function assertFaceGeometry(h, date, expected) {
  const cell = h.cell(date), s = h.style, [height, numberSize, letterCenter, numberCenter, markCenter, markHeight, letterOpacity] = expected;
  const numbers = cell.findAllByType('Text').filter(n => s(n).fontSize === 17);
  const letters = cell.findAllByType('Text').filter(n => s(n).height === 16);
  const marks = cell.findAllByType('AnimatedView').filter(n => s(n).width === 18);
  assert.ok(numbers.length > 0); assert.equal(letters.length, numbers.length); assert.equal(marks.length, numbers.length);
  for (const n of numbers) {
    near(verticalBounds(n).center, numberCenter, 'number center');
    const scale = s(n).transform.find(t => 'scale' in t)?.scale;
    near(s(n).fontSize * scale, numberSize, 'apparent number size');
    assert.ok(s(n).transform.every(t => !('scaleX' in t) && !('scaleY' in t)), 'number scales uniformly');
    assert.equal(s(n).lineHeight, 20);
  }
  for (const n of letters) {
    near(verticalBounds(n).center, letterCenter, 'letter center');
    near(s(n).opacity, letterOpacity, 'letter opacity');
  }
  for (const n of marks) {
    near(verticalBounds(n).center, markCenter, 'mark center');
    near(verticalBounds(n).height, markHeight, 'mark height');
    assert.equal(s(n).borderRadius, 2);
  }
  const tops = cell.findAll(n => n.props.testID === 'pill-cap-top');
  const middles = cell.findAll(n => n.props.testID === 'pill-middle');
  const bottoms = cell.findAll(n => n.props.testID === 'pill-cap-bottom');
  assert.equal(tops.length, numbers.length);
  for (let i = 0; i < tops.length; i++) {
    const top = tops[i], middle = middles[i], bottom = bottoms[i];
    assert.deepEqual(verticalBounds(top), { top: 0, bottom: 14, center: 7, height: 14 });
    near(verticalBounds(middle).top, 14, 'top seam');
    near(verticalBounds(middle).bottom, height - 14, 'bottom seam');
    near(verticalBounds(bottom).top, height - 14, 'bottom cap top');
    near(verticalBounds(bottom).bottom, height, 'pill bottom');
    assert.equal(s(top).borderTopLeftRadius, 14); assert.equal(s(top).borderTopRightRadius, 14);
    assert.equal(s(bottom).borderBottomLeftRadius, 14); assert.equal(s(bottom).borderBottomRightRadius, 14);
    assert.equal(s(top).borderTopWidth, 1); assert.equal(s(bottom).borderBottomWidth, 1);
    assert.equal(s(top).transform, undefined);
    assert.ok(s(bottom).transform.every(t => Object.keys(t).every(k => k === 'translateY')));
    for (const n of [top, middle, bottom]) {
      assert.equal(s(n).borderLeftWidth, 1); assert.equal(s(n).borderRightWidth, 1);
      assert.ok((s(n).transform ?? []).every(t => !('scaleX' in t) && !('scale' in t)), 'horizontal stroke stays unscaled');
    }
    assert.equal(s(top).borderBottomWidth, 0); assert.equal(s(middle).borderTopWidth, 0);
    assert.equal(s(middle).borderBottomWidth, 0); assert.equal(s(bottom).borderTopWidth, 0);
  }
  const touch = h.day(date);
  near(verticalBounds(touch).top, 0, 'touch top'); near(verticalBounds(touch).height, height, 'touch height');
  assert.deepEqual(touch.props.hitSlop, { top: 4, bottom: 4 });
  assert.equal(touch.findAllByType('Text').length, 0, 'touch scaling has no painted text descendants');
  const visual = cell.findAll(n => typeof n.type === 'string' && n.props.pointerEvents === 'none')[0];
  assert.equal(visual.props.accessibilityElementsHidden, true);
  assert.equal(visual.props.importantForAccessibility, 'no-hide-descendants');
  // No scaled ancestor may squash a number or the circular pill corners.
  for (const node of [...numbers, ...tops]) {
    for (let parent = node.parent; parent && parent !== cell; parent = parent.parent) {
      assert.ok((s(parent).transform ?? []).every(t => !('scaleY' in t) && !('scale' in t)));
    }
  }
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
  const cell = date => tree.root.findAllByType('View').find(n => n.props.testID === 'day-cell-'+date);
  const pill = date => cell(date).findAllByType('AnimatedView').find(n => n.props.testID === 'day-active-'+dates.dateIdToEpochDay(date));
  const marker = pill;
  const heading = text => tree.root.findAllByType('AnimatedView').find(n => n.props.testID?.startsWith('date-label-expanded-') && n.findAllByType('Text').some(t => [t.props.children].flat().join('') === text));
  const weeks = () => tree.root.findAllByType('AnimatedView').filter(n => n.props.testID?.startsWith('week-layer-'));
  return { tree, nav, position, interaction, collapse, theme, routes, day, cell, pill, marker, heading, weeks, viewport, style, resize,
    commits: () => commits,
    gesture: () => gestures.at(-1).handlers,
    async frames(values) { await renderer.act(async () => { for (const value of values) position.value = dates.dateIdToEpochDay(initial)+value; }); },
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
    const buttons = h.tree.root.findAllByType('Button');
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
    assert.equal(verticalBounds(h.day('2026-12-02')).height, 54);
    assert.equal(h.style(h.viewport()).height, 64.5);
    await h.frames([0.5]);
    assert.equal(h.style(layer('expanded')).opacity, 0.5);
    assert.equal(h.style(layer('compact')).opacity, 0.5);
    assert.equal(h.commits(), baseline, 'UI-only scroll and pager frames do not commit React');
    assert.equal(h.nav.get(), '2026-12-02');
    await h.collapseTo(216); await h.compactMode(true);
    assert.equal(calendars().length, 1);
    assert.equal(h.style(calendars()[0]).width, 44); assert.equal(h.style(calendars()[0]).height, 28);
    assert.equal(verticalBounds(h.day('2026-12-02')).height, 36);
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

test('all 42 faces retain fixed layout while reconstructed bounds collapse, clamp and reverse', async () => {
  const h = await harness('2026-12-02');
  const expanded = [60, 17, 16, 36, 50, 4, 1];
  const middle = [48, 16, 10.25, 26.25, 40, 3.5, 0];
  const compact = [36, 15, 4.5, 16.5, 30, 3, 0];
  try {
    const cells = h.tree.root.findAllByType('View').filter(n => n.props.testID?.startsWith('day-cell-'));
    assert.equal(cells.length, 21);
    assert.equal(cells.flatMap(c => c.findAllByType('Text').filter(n => h.style(n).fontSize === 17)).length, 42);
    const layouts = cells.map(fixedLayout), weekLayouts = h.weeks().map(fixedLayout);
    const commits = h.commits(), revision = h.nav.getRevision();
    for (const [offset, viewportHeight, inset, expected] of [
      [-20, 72, 4, expanded], [0, 72, 4, expanded], [108, 57, 3, middle],
      [216, 42, 2, compact], [300, 42, 2, compact], [216, 42, 2, compact],
      [108, 57, 3, middle], [0, 72, 4, expanded],
    ]) {
      await h.collapseTo(offset);
      assert.equal(h.style(h.viewport()).overflow, 'hidden');
      assert.equal(h.style(h.viewport()).height, viewportHeight);
      for (const week of h.weeks()) {
        const row = week.findAllByType('AnimatedView').find(n => n.props.testID?.startsWith('week-row-'));
        near(h.style(week).paddingTop + (h.style(row).transform[0].translateY), inset, 'week top inset');
        near(viewportHeight - inset - expected[0], inset * 2, 'week bottom inset');
      }
      // Includes all offscreen weeks and both transparent/selected face trees.
      for (const cell of cells) assertFaceGeometry(h, cell.props.testID.slice('day-cell-'.length), expected);
      assert.deepEqual(cells.map(fixedLayout), layouts, 'no repeated fontSize, height or padding changes');
      assert.deepEqual(h.weeks().map(fixedLayout), weekLayouts, 'week layers retain fixed layout');
      for (const cell of cells) {
        for (const node of cell.findAll(n => typeof n.type === 'string')) {
          for (const animated of flatten(node.props.style).filter(s => s.read)) {
            assert.ok(Object.keys(animated.read()).every(key => ['transform', 'opacity'].includes(key)), 'repeated worklets only change presentation');
          }
        }
      }
    }
    assert.equal(h.commits(), commits); assert.equal(h.nav.getRevision(), revision);
  } finally { await h.close(); }
});

test('nested collapse and horizontal paging compose through drag reversal, cancellation and resize', async () => {
  const h = await harness();
  const row = () => h.weeks()[1].findAllByType('AnimatedView').find(n => n.props.testID === 'week-row-0');
  try {
    const commits = h.commits();
    await h.collapseTo(108); await h.frames([0.5]);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -200 }]);
    assert.deepEqual(h.style(row()).transform, [{ translateY: -1 }]);
    await h.frames([0]); await h.begin(); await h.drag(-160);
    await h.collapseTo(216);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -160 }]);
    assert.deepEqual(h.style(row()).transform, [{ translateY: -2 }]);
    await h.drag(80); await h.collapseTo(108);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: 80 }]);
    assert.deepEqual(h.style(row()).transform, [{ translateY: -1 }]);
    await renderer.act(async () => h.gesture().onFinalize());
    await h.finish(); await h.flush(); assert.equal(h.nav.getRevision(), 0);
    await h.resize(500); await h.frames([0.5]);
    assert.deepEqual(h.style(h.weeks()[1]).transform, [{ translateX: -250 }]);
    assert.deepEqual(h.style(row()).transform, [{ translateY: -1 }]);
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
      assertFaceGeometry(h, '2026-12-02', [60, 17, 16, 36, 50, 4, 1]);
      if (withCollapse) {
        await h.collapseTo(108);
        assert.equal(h.style(h.viewport()).height, 57);
        assertFaceGeometry(h, '2026-12-02', [48, 16, 10.25, 26.25, 40, 3.5, 0]);
        await h.collapseTo(216);
      }
      await h.compactMode(true);
      assert.equal(h.style(h.viewport()).height, 42);
      assertFaceGeometry(h, '2026-12-02', [36, 15, 4.5, 16.5, 30, 3, 0]);
      const calendar = h.tree.root.findAllByType('Button').filter(n => n.props.accessibilityLabel === 'Elegir fecha' && n.props.accessible);
      assert.equal(calendar.length, 1);
      await renderer.act(async () => calendar[0].props.onPress()); assert.deepEqual(h.routes, ['/date-picker']);
      await renderer.act(async () => h.day('2026-12-04').props.onPress());
      assert.equal(h.nav.get(), '2026-12-04');
    } finally { await h.close(); }
  }
});

test('day press feedback dims the painted sibling and restores it without React or date writes', async () => {
  const h = await harness('2026-12-02');
  const visual = date => h.cell(date).findAllByType('AnimatedView').find(n => n.props.pointerEvents === 'none');
  try {
    await h.collapseTo(108);
    const commits = h.commits(), layout = fixedLayout(h.cell('2026-12-02'));
    assert.equal(h.style(visual('2026-12-02')).opacity, 1);
    await renderer.act(async () => h.day('2026-12-02').props.onPressIn());
    await h.finish();
    assert.equal(h.style(visual('2026-12-02')).opacity, 0.2);
    assert.equal(h.style(visual('2026-12-03')).opacity, 1, 'feedback belongs to the touched date');
    assert.equal(h.style(h.pill('2026-12-02')).opacity, 1, 'selected presentation remains independent');
    await h.collapseTo(216);
    assert.equal(h.style(visual('2026-12-02')).opacity, 0.2, 'collapse does not replace the press opacity');
    await renderer.act(async () => h.day('2026-12-02').props.onPressOut());
    await h.finish();
    assert.equal(h.style(visual('2026-12-02')).opacity, 1);
    assert.deepEqual(fixedLayout(h.cell('2026-12-02')), layout);
    assert.equal(h.commits(), commits); assert.equal(h.nav.getRevision(), 0);
    await renderer.act(async () => h.day('2026-12-03').props.onPress());
    assert.equal(h.nav.getRevision(), 1, 'only the actual press commands navigation');
  } finally { await h.close(); }
});
