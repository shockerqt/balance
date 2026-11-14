const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer');
const presentation = local('./src/lib/diary-presentation.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
// Test-only protocol for the rejected projection design. It must not ship as
// unused product helpers; its counterexample prevents repeating that approach.
const epoch = { surface: 1, generation: 2, geometry: 1 };
const rejectedProjectionProtocol = {
  initialOffsetProof: instance => ({ instance, serial: 0, fresh: true, kind: 'initial-known', offset: 0 }),
  requestOffset(proof, offset) {
    if (proof.kind !== 'pending' && Math.abs(proof.offset - offset) < 0.001) return proof;
    return { ...proof, serial: proof.serial + 1, fresh: false, kind: 'pending', offset };
  },
  observeOffset(proof, instance, serial, offset) {
    if (proof.instance !== instance || proof.serial !== serial || !Number.isFinite(offset)) return proof;
    return { ...proof, fresh: proof.fresh && offset === 0, kind: 'observed', offset };
  },
  allowLibraryOffset(proof, command, current, offset) {
    return command.surface === current.surface && command.generation === current.generation
      && command.geometry === current.geometry && proof.kind !== 'pending'
      && Math.abs(proof.offset - offset) < 0.001;
  },
};

function installedLegendBridge(options = {}) {
  const viewportHeight = options.viewportHeight || 800;
  let nativeOffset = 0, observedScrollEvents = 0, nativeCommandCalls = 0;
  let nativeProps, now = 0, nextTask = 0, nextView = 0, contentHeight = 0;
  const nativeFrames = new Map(), priorLayouts = new Map(), reactions = [];
  const tasks = new Map(), originals = {};
  for (const key of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout']) originals[key] = global[key];
  const originalDateNow = Date.now;
  Date.now = () => now;
  global.requestAnimationFrame = fn => { const id = ++nextTask; tasks.set(id, { at: now + 16, fn: () => fn(now) }); return id; };
  global.cancelAnimationFrame = id => tasks.delete(id);
  global.setTimeout = (fn, delay = 0) => { const id = ++nextTask; tasks.set(id, { at: now + delay, fn }); return id; };
  global.clearTimeout = id => tasks.delete(id);
  const commandLog = [];
  const jsEvents = [], measurements = [];
  let retainEvents = false, retainMeasurements = false;
  let proof = rejectedProjectionProtocol.initialOffsetProof(1), currentEpoch = { ...epoch };
  const nativeHost = { getNativeScrollRef() { return this; }, getScrollableNode() { return this; },
    getCurrentScrollOffset() { return nativeOffset; },
    measure(fn) { fn(0, 0, 400, viewportHeight, 0, 0); }, setNativeProps() {}, scrollTo({ y }) {
    nativeCommandCalls++;
    const next = Math.max(0, Math.min(contentHeight ? Math.max(0, contentHeight - viewportHeight) : 216, y));
    // RN0.86 scrollTo updates Fabric state but does not itself emit onScroll.
    // Android's onScrollChanged is reached when super.scrollTo changes the offset.
    if (next !== nativeOffset) {
      nativeOffset = next; observedScrollEvents++;
      const event = { nativeEvent: {
        contentOffset: { x: 0, y: nativeOffset }, contentSize: { width: 400, height: contentHeight || 1016 },
        layoutMeasurement: { width: 400, height: viewportHeight },
        contentInset: { top: 0, bottom: 0, left: 0, right: 0 }, velocity: { x: 0, y: 0 },
      } };
      nativeProps?.diaryScrollObservation?.({ ...event.nativeEvent, eventName: 'onScroll' });
      if (retainEvents) jsEvents.push(() => nativeProps?.onScroll?.(event));
      else nativeProps?.onScroll?.(event);
    }
  } };
  const proxy = new Proxy(nativeHost, { get(target, key) {
    if (key === 'getNativeScrollRef') return () => nativeHost;
    if (key === 'scrollTo') return args => {
      const commandEpoch = { ...currentEpoch }, requested = args.y ?? 0;
      const run = () => {
        const allowed = !options.guard || rejectedProjectionProtocol.allowLibraryOffset(proof, commandEpoch, currentEpoch, requested);
        commandLog.push({ requested, allowed, epoch: commandEpoch });
        if (allowed) target.scrollTo(args);
        else options.onRejected?.();
      };
      if (options.delayCommands) global.requestAnimationFrame(run); else run();
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const assignRef = (ref, value) => { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value; };
  const ScrollView = React.forwardRef(function NativeScrollHost(props, ref) {
    nativeProps = props;
    React.useImperativeHandle(ref, () => options.guard ? proxy : nativeHost, []);
    return React.createElement('NativeScrollHost', props);
  });
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  const NativeView = React.forwardRef(function NativeViewHost(props, ref) {
    const id = React.useRef(++nextView).current;
    React.useImperativeHandle(ref, () => ({ measure(fn) {
      const style = flatten(props.style);
      const run = () => {
        const frame = nativeFrames.get(id);
        fn(0, frame?.localY ?? style.top ?? 0, frame?.width ?? style.width ?? 400, frame?.height ?? style.height ?? 48,
          0, (frame?.documentY ?? ((options.prefix || 0) + (style.top || 0))) - nativeOffset);
      };
      if (retainMeasurements) measurements.push(run); else run();
    }, setNativeProps() {} }), [props.style]);
    return React.createElement('NativeView', { ...props, boundaryView: id }, props.children);
  });
  class AnimatedValue { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const native = { View: NativeView, TouchableOpacity: NativeView, Text: 'NativeText', RefreshControl: 'RefreshControl',
    Platform: { OS: 'android', select: values => values.android ?? values.default },
    I18nManager: { isRTL: false }, PixelRatio: { get: () => 1, roundToNearestPixel: n => n },
    Dimensions: { get: () => ({ width: 400, height: viewportHeight }) },
    AccessibilityInfo: { addEventListener: () => ({ remove() {} }), isScreenReaderEnabled: async () => false },
    StyleSheet: { flatten, create: value => value, absoluteFill: {}, absoluteFillObject: {} },
    Animated: { View: NativeView, ScrollView, Value: AnimatedValue, event: (_mappings, options) => options.listener },
  };
  // Node's default export condition resolves the web bundle. Metro Android uses
  // this installed native bundle; execute it explicitly rather than testing web.
  const coreFilename = path.join(path.dirname(local.resolve('@legendapp/list/react-native')), 'react-native.js');
  const core = new Module(coreFilename, module);
  core.filename = coreFilename;
  core.require = name => {
    if (name === 'react-native') return native;
    return local(name);
  };
  const previousFabric = global.nativeFabricUIManager;
  global.nativeFabricUIManager = {};
  core._compile(fs.readFileSync(coreFilename, 'utf8'), coreFilename);
  global.nativeFabricUIManager = previousFabric;
  const reanimated = { ScrollView, View: NativeView, createAnimatedComponent: component => component,
    useSharedValue: value => React.useRef({ value }).current,
    useAnimatedRef: () => {
      const ref = React.useRef(null);
      if (!ref.current) { const callback = value => { callback.current = value; }; callback.current = null; ref.current = callback; }
      return ref.current;
    },
    useAnimatedReaction(prepare, react) {
      const latest = React.useRef({ prepare, react }); latest.current = { prepare, react };
      React.useLayoutEffect(() => {
        const item = { latest, prior: undefined }; reactions.push(item);
        return () => { reactions.splice(reactions.indexOf(item), 1); };
      }, []);
    },
    useEvent: fn => fn, useAnimatedStyle: fn => ({ read: fn }), useScrollViewOffset() {},
    useReducedMotion: () => !!options.reducedMotion, runOnJS: fn => fn, runOnUI: fn => fn,
    scrollTo: (ref, x, y, animated) => ref.current?.scrollTo({ x, y, animated }),
  };
  const stubs = { react: React, 'react-native': native, 'react-native-reanimated': reanimated,
    '@legendapp/list/react-native': core.exports };
  const filename = local.resolve('@legendapp/list/reanimated'), m = new Module(filename, module);
  m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; throw Error('Unexpected adapter dependency '+name); };
  // Execute the installed adapter AND core. Only native hosts/Reanimated native
  // boundaries are models; React, Legend effects, helpers and scheduler are real.
  m._compile(fs.readFileSync(filename, 'utf8'), filename);
  const firstHosts = node => {
    if (!node || typeof node !== 'object') return [];
    if (['NativeView', 'NativeScrollHost', 'NativeText'].includes(node.type)) return [node];
    return node.children.flatMap(firstHosts);
  };
  const layoutNode = (node, documentY = 0, localY = 0) => {
    const style = flatten(node.props.style);
    const paddingTop = style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0;
    const paddingBottom = style.paddingBottom ?? style.paddingVertical ?? style.padding ?? 0;
    const children = node.children.flatMap(firstHosts);
    let flow = paddingTop, tallest = 0;
    for (const child of children) {
      const childStyle = flatten(child.props.style), absolute = childStyle.position === 'absolute';
      const childY = absolute ? childStyle.top || 0 : style.flexDirection === 'row' ? paddingTop : flow;
      const height = layoutNode(child, documentY + childY, childY);
      if (!absolute) {
        tallest = Math.max(tallest, height);
        if (style.flexDirection !== 'row') flow += height + (style.gap || style.rowGap || 0);
      }
    }
    if (children.length && style.flexDirection !== 'row') flow -= style.gap || style.rowGap || 0;
    const natural = node.type === 'NativeText' ? style.lineHeight || style.fontSize || 20
      : (style.flexDirection === 'row' ? paddingTop + tallest : flow) + paddingBottom;
    const height = Math.max(typeof style.minHeight === 'number' ? style.minHeight : 0,
      typeof style.height === 'number' ? style.height : natural);
    if (node.props.boundaryView) nativeFrames.set(node.props.boundaryView, { documentY, localY, width: 400, height });
    return height;
  };
  return { List: m.exports.AnimatedLegendList, nativeHost, NativeView,
    results: () => ({ nativeOffset, observedScrollEvents, nativeCommandCalls }), props: () => nativeProps,
    commandLog, tasks,
    frame: node => { const frame = nativeFrames.get(node.props.boundaryView); return { ...frame, pageY: frame.documentY - nativeOffset }; },
    retainEvents(value) { retainEvents = value; },
    deliverEvents() { for (const run of jsEvents.splice(0)) run(); },
    retainMeasurements(value) { retainMeasurements = value; },
    deliverMeasurements() { for (const run of measurements.splice(0)) run(); },
    advanceNativeWithoutEvent(value) { nativeOffset = value; },
    loadFeed() {
      const ts = local('typescript'), filename = path.join(root, 'src/components/meal/meal-group-feed.tsx');
      const feed = new Module(filename, module); feed.filename = filename;
      const theme = local('./src/theme/palettes.ts').makeBalanceTheme('light');
      const dependencies = {
        react: React, 'react/jsx-runtime': local('react/jsx-runtime'), 'react-native': native,
        'react-native-reanimated': reanimated, '@legendapp/list/reanimated': m.exports,
        '@/lib/meal-groups': local('./src/lib/meal-groups.ts'), '@/lib/nutrition': local('./src/lib/nutrition.ts'),
        '@/lib/diary-presentation': presentation, '@/dev/native-pager-status': local('./src/dev/native-pager-status.ts'),
        '@/theme': { makeStyles: build => () => build(theme) },
        '@/components/ui': { Icon: () => React.createElement('NativeText', { style: { lineHeight: 16 } }),
          Text: ({ children, variant = 'body', style }) => React.createElement('NativeText', { style: [theme.type[variant], style] }, children) },
      };
      feed.require = name => { if (name in dependencies) return dependencies[name]; throw Error('Unexpected real-feed dependency '+name); };
      feed._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
      } }).outputText, filename);
      return feed.exports.MealGroupFeed;
    },
    flushUI() {
      for (let turn = 0; turn < 20; turn++) {
        let changed = false;
        for (const reaction of [...reactions]) {
          const next = reaction.latest.current.prepare();
          if (JSON.stringify(next) !== JSON.stringify(reaction.prior)) {
            const previous = reaction.prior; reaction.prior = next;
            reaction.latest.current.react(next, previous); changed = true;
          }
        }
        if (!changed) return;
      }
      assert.fail('UI reactions did not converge');
    },
    async layout(tree) {
      await renderer.act(async () => {
        const scroll = tree.root.findByType('NativeScrollHost');
        let flow = 0;
        for (const child of scroll.children.flatMap(firstHosts)) {
          const style = flatten(child.props.style), absolute = style.position === 'absolute';
          const y = absolute ? style.top || 0 : flow;
          const height = layoutNode(child, y, y);
          if (!absolute) flow += height;
        }
        const contentStyle = flatten(scroll.props.contentContainerStyle);
        contentHeight = Math.max(contentStyle.minHeight || 0, flow + (contentStyle.paddingBottom || 0));
        for (const node of tree.root.findAllByType('NativeView')) {
          const frame = nativeFrames.get(node.props.boundaryView);
          if (node.props.onLayout && JSON.stringify(priorLayouts.get(node.props.boundaryView)) !== JSON.stringify(frame)) {
            priorLayouts.set(node.props.boundaryView, frame);
            node.props.onLayout({ nativeEvent: { layout: { x: 0, y: frame.localY, width: 400, height: frame.height } } });
          }
        }
        scroll.props.onLayout?.({ nativeEvent: { layout: { width: 400, height: viewportHeight, x: 0, y: 0 } } });
        scroll.props.onContentSizeChange?.(400, contentHeight);
      });
    },
    setEpoch(next) { currentEpoch = next; },
    project(offset) {
      proof = rejectedProjectionProtocol.requestOffset(proof, offset);
      nativeHost.scrollTo({ y: offset });
      if (proof.kind === 'pending') proof = rejectedProjectionProtocol.observeOffset(proof, 1, proof.serial, nativeOffset);
    },
    async flush() {
      for (let turn = 0; tasks.size && turn < 100; turn++) {
        const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        tasks.delete(id); now = task.at;
        await renderer.act(async () => { task.fn(); });
      }
      assert.equal(tasks.size, 0, 'real Legend scheduler must settle within the bounded host trace');
    },
    restore() { for (const [key, value] of Object.entries(originals)) global[key] = value; Date.now = originalDateNow; },
  };
}

test('installed Legend3.7.1 adapter forwards refScrollView to its native scroll host', async () => {
  const harness = installedLegendBridge(), nativeRef = React.createRef(), listRef = React.createRef();
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(harness.List, {
      ref: listRef, refScrollView: nativeRef, data: [], initialScrollOffset: 0,
      maintainVisibleContentPosition: false, contentContainerStyle: { minHeight: 1016 },
    })); });
    assert.equal(nativeRef.current, harness.nativeHost);
    assert.equal(typeof listRef.current.getState, 'function');
    assert.equal(Object.assign({}, ...tree.root.findByType('NativeScrollHost').props.contentContainerStyle.filter(Boolean)).minHeight, 1016);
    assert.deepEqual(tree.root.findByType('NativeScrollHost').props.contentOffset, { x: 0, y: 0 });
    nativeRef.current.scrollTo({ y: 216 });
    nativeRef.current.scrollTo({ y: 0 });
    assert.deepEqual(harness.results(), { nativeOffset: 0, observedScrollEvents: 2, nativeCommandCalls: 2 });
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('hard gate counterexample: fresh zero plus no-op scrollTo cannot supply an observed zero acknowledgement', async () => {
  const harness = installedLegendBridge(), nativeRef = React.createRef();
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(harness.List, {
      refScrollView: nativeRef, data: [], initialScrollOffset: 0,
      maintainVisibleContentPosition: false, contentContainerStyle: { minHeight: 1016 },
    })); });
    nativeRef.current.scrollTo({ y: 0 });
    assert.deepEqual(harness.results(), { nativeOffset: 0, observedScrollEvents: 0, nativeCommandCalls: 1 });
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('actual Legend core effects and ScheduledWork preserve supported zero initialization for empty/short/long data', async () => {
  for (const count of [0, 2, 40]) {
    const harness = installedLegendBridge(), nativeRef = React.createRef(), listRef = React.createRef();
    let tree;
    try {
      await renderer.act(async () => { tree = renderer.create(React.createElement(harness.List, {
        ref: listRef, refScrollView: nativeRef, data: Array.from({ length: count }, (_, id) => ({ id })),
        renderItem: ({ item }) => React.createElement('Item', { id: item.id }),
        initialScrollOffset: 0, maintainVisibleContentPosition: false, recycleItems: true,
        contentContainerStyle: { minHeight: 1016 },
      })); });
      await harness.flush();
      assert.deepEqual(harness.props().contentOffset, { x: 0, y: 0 });
      assert.equal(harness.results().nativeOffset, 0);
      assert.ok(harness.commandLog.every(command => command.requested === 0));
      assert.equal(nativeRef.current, harness.nativeHost);
      assert.equal(listRef.current.getState().scroll, 0);
    } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
  }
});

test('rejected B design: discarding a late native command leaves real Legend and native offsets inconsistent', async () => {
  const harness = installedLegendBridge({ guard: true, delayCommands: true });
  const listRef = React.createRef(); let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(harness.List, {
      ref: listRef, data: [], initialScrollOffset: 0, maintainVisibleContentPosition: false,
      contentContainerStyle: { minHeight: 1016 },
    })); });
    await harness.flush();
    // A callback originating in the prior epoch reaches the real core after UI
    // has projected the next generation. Its command is delayed at the UI seam.
    let pending;
    global.requestAnimationFrame(() => { pending = listRef.current.scrollToOffset({ offset: 100, animated: false }); });
    harness.setEpoch({ ...epoch, generation: epoch.generation + 1 });
    harness.project(54);
    assert.equal(listRef.current.getState().scroll, 54, 'the host delivered the real offset event before the late callback');
    await harness.flush();
    assert.equal(harness.results().nativeOffset, 54);
    assert.ok(harness.commandLog.some(command => command.requested === 100 && !command.allowed));
    assert.equal(listRef.current.getState().scroll, 100,
      'this is evidence against B, not an adopted command suppression strategy');
    listRef.current.cancelScroll();
    await harness.flush();
    await pending;
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('C2 real core: native zero, JS convergence, committed recycled identity and measured range are distinct gates', async () => {
  const harness = installedLegendBridge({ prefix: 336 }), listRef = React.createRef(), nativeRef = React.createRef();
  const committed = new Map(); let tree;
  function Item({ item }) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => { committed.set(String(item.id), ref.current); return () => committed.delete(String(item.id)); }, [item.id]);
    return React.createElement(harness.NativeView, { ref, style: { height: 100 }, testID: `group-${item.id}` });
  }
  const props = {
    ref: listRef, refScrollView: nativeRef,
    data: Array.from({ length: 40 }, (_, id) => ({ id })), keyExtractor: item => String(item.id),
    renderItem: ({ item }) => React.createElement(Item, { item }), getFixedItemSize: () => 100,
    initialScrollOffset: 0, maintainVisibleContentPosition: false, recycleItems: true,
    ListHeaderComponent: React.createElement(harness.NativeView, { style: { height: 336 } }),
    contentContainerStyle: { paddingBottom: 16 },
  };
  const requiredKeys = () => {
    const state = listRef.current.getState(), keys = [];
    for (let index = state.start; index <= state.end; index++) if (index >= 0 && index < props.data.length) keys.push(String(props.data[index].id));
    return keys;
  };
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(harness.List, props)); });
    await harness.flush();
    await renderer.act(async () => nativeRef.current.scrollTo({ y: 1200 }));
    await harness.flush();
    assert.equal(listRef.current.getState().scroll, 216, 'model native bounds are explicitly216 in this fixture');
    // Move farther through an actual native event; no fake core-state setter is used.
    harness.advanceNativeWithoutEvent(1200);
    await renderer.act(async () => harness.props().onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 1200 }, contentSize: { width: 400, height: 4352 },
      layoutMeasurement: { width: 400, height: 800 }, contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
    } }));
    await harness.flush();
    assert.equal(listRef.current.getState().scroll, 1200);
    assert.ok(!committed.has('0'), 'the old rendered range must not accidentally contain the destination first group');
    harness.retainEvents(true);
    harness.retainMeasurements(true);
    nativeRef.current.scrollTo({ y: 0 });
    const evidence = { connected: true, current: true, header: true, nativeZero: true,
      coreZero: false, committedRange: false, measuredRange: false };
    assert.equal(harness.results().nativeOffset, 0);
    assert.equal(listRef.current.getState().scroll, 1200);
    assert.equal(presentation.canEnterPage(evidence), false, 'UI/native acknowledgement cannot unblock reversal before JS');
    await renderer.act(async () => {
      harness.deliverEvents();
      assert.equal(listRef.current.getState().scroll, 0);
      evidence.coreZero = true;
      evidence.committedRange = requiredKeys().every(key => committed.has(key));
      assert.equal(evidence.committedRange, false, 'core range changes precede the React commit');
      assert.equal(presentation.canEnterPage(evidence), false);
    });
    await harness.flush();
    const state = listRef.current.getState();
    const keys = requiredKeys();
    assert.ok(keys.length > 0);
    evidence.committedRange = keys.every(key => committed.has(key));
    assert.equal(evidence.committedRange, true, 'new recycled keys were committed through actual layout effects');
    let measured = 0;
    for (let index = state.start; index <= state.end; index++) {
      const view = state.elementAtIndex(index);
      assert.equal(typeof view.measure, 'function', 'actual core exposes a connected native element for each visible index');
      view.measure((_x, _y, width, height, _pageX, pageY) => {
        assert.ok(width > 0 && height > 0 && Number.isFinite(pageY));
        measured++;
      });
    }
    assert.equal(measured, 0);
    assert.equal(presentation.canEnterPage(evidence), false, 'committed rows still need their current native bounds');
    harness.deliverMeasurements();
    evidence.measuredRange = measured === keys.length;
    assert.equal(presentation.canEnterPage(evidence), true);
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('actual feed cancellation does not freeze or restore a coalesced source offset', async () => {
  const harness = installedLegendBridge(), Feed = harness.loadFeed(), day = 42;
  const offset = { value: 0 };
  const context = { motion: { value: { ...presentation.createDiaryMotion(day, 1), initialized: true } },
    ready: { value: {} }, interaction: { value: 0 }, headerTouch() {} };
  const foods = Array.from({ length: 30 }, (_, index) => ({ id: `f${index}`, name: 'Fixture', portion: '1 g',
    time: '08:00', calories: 1, protein: 0, carbs: 0, fat: 0 }));
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Feed, {
      foods, empty: React.createElement('Empty'), scrollOffset: offset, presentation: context, dayNumber: day,
      prefix: 336, collapseDistance: 216, headerReady: true, onSelectFood() {}, onAddAtHour() {},
    })); });
    for (let pass = 0; pass < 5; pass++) { await harness.layout(tree); await harness.flush(); harness.flushUI(); }
    await renderer.act(async () => harness.nativeHost.scrollTo({ y: 400 }));
    harness.flushUI();
    assert.equal(offset.value, 400);
    harness.advanceNativeWithoutEvent(420);
    const before = harness.results();
    context.motion.value = { ...context.motion.value, phase: 1, position: day + 0.4 };
    await renderer.act(async () => harness.flushUI());
    context.motion.value = { ...context.motion.value, phase: 0, position: day, selected: day };
    await renderer.act(async () => harness.flushUI());
    assert.deepEqual(harness.results(), before);
    assert.equal(harness.results().nativeOffset, 420);
    assert.equal(offset.value, 400, 'a stale observed sample does not cause a native rewind');
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('installed Reanimated native event registration observes pager UI events without replacing ordinary JS callbacks', () => {
  const ts = local('typescript'), registrations = [], handlers = new Map();
  const directory = path.join(path.dirname(local.resolve('react-native-reanimated/package.json')), 'src');
  const compile = (relative, dependencies) => {
    const filename = path.join(directory, relative), m = new Module(filename, module); m.filename = filename;
    m.require = name => { if (name in dependencies) return dependencies[name]; throw Error('Unexpected seam dependency '+name); };
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, filename);
    return m.exports;
  };
  const has = (key, object) => object != null && typeof object === 'object' && key in object;
  const eventModule = compile('WorkletEventHandler.ts', {
    './common': { SHOULD_BE_USE_WEB: false },
    './core': { registerEventHandler(worklet, name, tag) {
      registrations.push({ name, tag }); handlers.set(name, worklet); return registrations.length;
    }, unregisterEventHandler() {} },
  });
  const { PropsFilter } = compile('createAnimatedComponent/PropsFilter.tsx', {
    '../animation': { initialUpdaterRun: fn => fn() }, '../css/utils': { isCSSConfigProp: () => false },
    '../isSharedValue': { isSharedValue: () => false }, '../WorkletEventHandler': eventModule,
    './InlinePropManager': { getInlineStyle: value => value, hasInlineStyles: () => false },
    './utils': { has, flattenArray: value => [value].flat(Infinity) },
  });
  const { NativeEventsManager } = compile('createAnimatedComponent/NativeEventsManager.ts', {
    '../platformFunctions/findNodeHandle': { findNodeHandle: () => 42 },
    '../WorkletEventHandler': eventModule, './utils': { has },
  });
  const ui = [], js = [];
  const handler = new eventModule.WorkletEventHandler(event => ui.push(event),
    ['onPageScroll', 'onPageSelected', 'onPageScrollStateChanged']);
  const props = { onPageScroll: { workletEventHandler: handler },
    onPageSelected: event => js.push(['selected', event]), onPageScrollStateChanged: event => js.push(['state', event]) };
  const component = { props, _isFirstRender: true, _componentRef: {}, getComponentViewTag: () => 42 };
  const manager = new NativeEventsManager(component);
  manager.attachEvents();
  const forwarded = new PropsFilter().filterNonAnimatedProps(component);
  assert.equal(forwarded.onPageSelected, props.onPageSelected);
  assert.equal(forwarded.onPageScrollStateChanged, props.onPageScrollStateChanged);
  assert.deepEqual(registrations.map(r => r.name), ['onPageScroll', 'onPageSelected', 'onPageScrollStateChanged']);
  for (const name of ['onPageSelected', 'onPageScrollStateChanged']) {
    handlers.get(name)({ eventName: name, position: 8, pageScrollState: 'idle' });
    forwarded[name]({ nativeEvent: { position: 8, pageScrollState: 'idle' } });
  }
  assert.equal(ui.length, 2); assert.equal(js.length, 2);
  manager.detachEvents();
});

test('actual MealGroupFeed plus installed Legend waits for native/core/committed bounds before offscreen reentry', async () => {
  const harness = installedLegendBridge(), Feed = harness.loadFeed();
  const day = 42, offset = { value: 0 };
  const context = { motion: { value: { ...presentation.createDiaryMotion(day, 1), initialized: true } },
    ready: { value: {} }, interaction: { value: 0 }, headerTouch() {} };
  const foods = Array.from({ length: 30 }, (_, index) => ({ id: `f${index}`, name: 'Fixture', portion: '1 g',
    time: index < 15 ? '08:00' : '13:00', calories: 1, protein: 0, carbs: 0, fat: 0 }));
  let tree;
  try {
    await renderer.act(async () => { tree = renderer.create(React.createElement(Feed, {
      foods, empty: React.createElement('Empty'), scrollOffset: offset, presentation: context, dayNumber: day,
      prefix: 336, collapseDistance: 216, headerReady: true, onSelectFood() {}, onAddAtHour() {},
    })); });
    for (let pass = 0; pass < 5; pass++) { await harness.layout(tree); await harness.flush(); harness.flushUI(); }
    assert.equal(context.ready.value[String(day)], true, 'initial known0 still requires actual committed native layout');
    await renderer.act(async () => harness.nativeHost.scrollTo({ y: 400 }));
    harness.flushUI();
    assert.equal(offset.value, 400);
    harness.retainEvents(true);
    harness.retainMeasurements(true);
    context.motion.value = { ...context.motion.value, visual: day + 1, selected: day + 1, position: day + 1,
      cleanup: day, serial: 1, phase: 0 };
    await renderer.act(async () => harness.flushUI());
    assert.equal(offset.value, 0, 'UI observer saw the native offscreen reset');
    assert.equal(context.ready.value[String(day)], false, 'native0 alone cannot unlock entry');
    await renderer.act(async () => harness.deliverEvents());
    await harness.flush();
    assert.equal(context.ready.value[String(day)], false, 'core0 plus commit still awaits native bounds');
    await renderer.act(async () => { harness.deliverMeasurements(); });
    await harness.flush();
    assert.equal(context.ready.value[String(day)], true, 'actual feed publishes readiness only after its current native measures');
    const commands = harness.results().nativeCommandCalls;
    context.motion.value = { ...context.motion.value, serial: 2 };
    await renderer.act(async () => harness.flushUI());
    await harness.flush();
    await renderer.act(async () => harness.deliverMeasurements());
    await harness.flush();
    assert.equal(harness.results().nativeCommandCalls, commands, 'already observed0 is retained without another native event');
    assert.equal(context.ready.value[String(day)], true);
  } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
});

test('actual feed corrects intrinsic estimates across fitting and keeps the last real row reachable', async () => {
  for (const mode of ['overestimate', 'underestimate']) {
    const harness = installedLegendBridge({ viewportHeight: mode === 'overestimate' ? 750 : 800 });
    const Feed = harness.loadFeed(), day = 42, offset = { value: 0 };
    const context = { motion: { value: { ...presentation.createDiaryMotion(day, 1), initialized: true } },
      ready: { value: {} }, interaction: { value: 0 }, headerTouch() {} };
    const foods = Array.from({ length: mode === 'overestimate' ? 4 : 30 }, (_, index) => ({ id: `f${index}`,
      name: `Fixture ${index}`, portion: '1 g', time: mode === 'overestimate' ? `${String(index + 8).padStart(2, '0')}:00` : '08:00',
      calories: 1, protein: 0, carbs: 0, fat: 0 }));
    let tree;
    try {
      await renderer.act(async () => { tree = renderer.create(React.createElement(Feed, {
        foods, empty: React.createElement('Empty'), scrollOffset: offset, presentation: context, dayNumber: day,
        prefix: 336, collapseDistance: 216, headerReady: true, onSelectFood() {}, onAddAtHour() {},
      })); });
      for (let pass = 0; pass < 6; pass++) { await harness.layout(tree); await harness.flush(); harness.flushUI(); }
      assert.equal(harness.props().scrollEnabled, mode === 'underestimate');
      if (mode === 'underestimate') {
        await renderer.act(async () => harness.nativeHost.scrollTo({ y: 100000 }));
        await harness.flush(); await harness.layout(tree); await harness.flush();
        const last = tree.root.findAllByType('NativeView').find(node => node.props.accessibilityLabel?.startsWith('Fixture 29,'));
        assert.ok(last);
        const frame = harness.frame(last);
        assert.ok(frame.pageY >= 0 && frame.pageY + frame.height <= 800, 'last native food row is reachable above base clearance');
      }
    } finally { if (tree) await renderer.act(async () => tree.unmount()); harness.restore(); }
  }
});
