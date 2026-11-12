const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript');
const React = local('react');
const renderer = local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function compile(relative, dependencies) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name} in ${relative}`);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return loaded.exports;
}

function setup({ reducedMotion = false, motionQuery, topInset = 47 } = {}) {
  let snapshot = Object.freeze({ phase: 'inactive', receivedDocuments: 0, pendingChanges: 0, lastSyncedAt: null, error: null });
  const listeners = new Set(), motionListeners = new Set();
  const calls = { retry: 0, starts: 0, stops: 0, motionRemoved: 0, childRenders: 0, subscribes: 0 };
  let retry = () => Promise.resolve();
  const syncClient = {
    getStatusSnapshot: () => snapshot,
    subscribeStatus(listener) { calls.subscribes++; listeners.add(listener); return () => listeners.delete(listener); },
    retrySync() { calls.retry++; return retry(); },
  };
  const native = {
    View: 'view', Text: 'text', Pressable: 'pressable', StyleSheet: { create: value => value },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => motionQuery || Promise.resolve(reducedMotion),
      addEventListener(name, callback) {
        assert.equal(name, 'reduceMotionChanged');
        motionListeners.add(callback);
        return { remove() { calls.motionRemoved++; motionListeners.delete(callback); } };
      },
    },
    Easing: { linear: value => value },
    Animated: {
      View: 'animated-track',
      Value: class {
        setValue() {}
        stopAnimation() {}
        interpolate(config) { return { interpolation: config }; }
      },
      timing(value, options) {
        assert.equal(options.useNativeDriver, true);
        assert.equal(options.isInteraction, false, 'background progress must not delay list work');
        return { value, options };
      },
      loop() { return { start() { calls.starts++; }, stop() { calls.stops++; } }; },
    },
  };
  const common = { react: React, 'react/jsx-runtime': local('react/jsx-runtime') };
  const tokens = compile('src/theme/tokens.ts', {});
  const theme = compile('src/theme/palettes.ts', { './tokens': tokens }).makeBalanceTheme('dark');
  const owner = { syncClient };
  const banner = compile('src/components/sync/sync-status-banner.tsx', {
    ...common,
    'react-native': native,
    '@/components/ui/Icon': { Icon: props => React.createElement('icon', props) },
    '@/services/sync/sync-client': owner,
    '@/theme': { useTheme: () => theme },
  });
  const screen = compile('src/components/ui/Screen.tsx', {
    ...common,
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaView: 'safe-area',
      useSafeAreaInsets: () => ({ top: topInset, bottom: 0, left: 0, right: 0 }),
    },
    '@/theme': { useTheme: () => theme },
    '@/components/sync/sync-status-banner': banner,
  });
  return {
    ...banner, ...screen, calls, listeners, motionListeners, owner,
    setRetry(callback) { retry = callback; },
    setStatus(next) { snapshot = Object.freeze({ ...snapshot, ...next }); for (const listener of listeners) listener(); },
    setMotion(value) { for (const listener of motionListeners) listener(value); },
    NativeHost() { calls.childRenders++; return React.createElement('native-host', { style: { flex: 1 } }); },
  };
}

const byId = (view, id) => view.root.findByProps({ testID: id });
const byLabel = (view, label) => view.root.findByProps({ accessibilityLabel: label });
const text = view => view.root.findAllByType('text').map(node => node.props.children).join(' ');
async function mount(Component, props, child) {
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(Component, props, child)); });
  return view;
}
async function unmount(view) { await renderer.act(async () => view.unmount()); }

test('syncAttention table covers inactive, healthy, error, offline, and stale states', () => {
  const { syncAttention } = setup();
  const base = { receivedDocuments: 0, pendingChanges: 0, lastSyncedAt: null, error: null };
  const cases = [
    [{ ...base, phase: 'inactive' }, false, null],
    [{ ...base, phase: 'inactive', pendingChanges: 2 }, true, null],
    [{ ...base, phase: 'synced' }, false, null],
    [{ ...base, phase: 'synced' }, true, null],
    [{ ...base, phase: 'offline', pendingChanges: 0 }, false, null],
    [{ ...base, phase: 'offline', pendingChanges: 0 }, true, null],
    [{ ...base, phase: 'offline', pendingChanges: 1 }, false, 'offline'],
    [{ ...base, phase: 'offline', pendingChanges: 1 }, true, 'offline'],
    [{ ...base, phase: 'connecting', pendingChanges: 0 }, false, null],
    [{ ...base, phase: 'connecting', pendingChanges: 1 }, false, null],
    [{ ...base, phase: 'connecting', pendingChanges: 1 }, true, 'stale'],
    [{ ...base, phase: 'syncing', pendingChanges: 0 }, false, null],
    [{ ...base, phase: 'syncing', pendingChanges: 2 }, false, null],
    [{ ...base, phase: 'syncing', pendingChanges: 2 }, true, 'stale'],
    [{ ...base, phase: 'pending', pendingChanges: 1 }, false, null],
    [{ ...base, phase: 'pending', pendingChanges: 1 }, true, 'stale'],
    [{ ...base, phase: 'error', error: 'download' }, false, 'error'],
    [{ ...base, phase: 'error', error: 'upload', pendingChanges: 3 }, true, 'error'],
  ];
  for (const [status, stale, expected] of cases) {
    assert.equal(syncAttention(status, stale), expected, `${status.phase} pending=${status.pendingChanges} stale=${stale}`);
  }
});

test('real banner hides healthy states, renders actual received counts in attention states and never claims a total/percentage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = setup();
  const view = await mount(h.SyncStatusBanner);
  assert.equal(view.toJSON(), null);
  await renderer.act(async () => h.setStatus({ phase: 'synced', receivedDocuments: 10, lastSyncedAt: Date.now() }));
  assert.equal(view.toJSON(), null);
  await renderer.act(async () => h.setStatus({ phase: 'offline', pendingChanges: 0 }));
  assert.equal(view.toJSON(), null);
  await renderer.act(async () => h.setStatus({ phase: 'connecting', pendingChanges: 0 }));
  assert.equal(view.toJSON(), null);
  assert.equal(h.calls.starts, 0);

  await renderer.act(async () => h.setStatus({ phase: 'connecting', pendingChanges: 1 }));
  assert.equal(view.toJSON(), null, 'healthy connecting under 2 minutes stays hidden');
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS));
  assert.match(text(view), /Conectando con el servidor/);
  assert.equal(h.calls.starts, 1);

  await renderer.act(async () => h.setStatus({ phase: 'syncing', receivedDocuments: 12345, pendingChanges: 3 }));
  assert.match(text(view), /12\.345 registros recibidos/);
  assert.match(text(view), /3 cambios pendientes/);
  assert.doesNotMatch(text(view), /%|total|de 12\.345|todos tus datos guardados/i);
  assert.equal(view.root.findAllByProps({ accessibilityRole: 'progressbar' }).length, 0, 'unknown totals must not expose an invented determinate range');
  assert.equal(byId(view, 'sync-status-title').props.accessibilityLiveRegion, 'polite');
  const phaseAnnouncement = byId(view, 'sync-status-title').props.accessibilityLabel;
  await renderer.act(async () => h.setStatus({ receivedDocuments: 12395 }));
  assert.equal(byId(view, 'sync-status-title').props.accessibilityLabel, phaseAnnouncement, 'a new batch must not generate a new phase announcement');
  assert.equal(byId(view, 'sync-status-detail').props.accessibilityLiveRegion, 'none');
  assert.match(byId(view, 'sync-status-detail').props.accessibilityLabel, /12\.395/);

  await renderer.act(async () => h.setStatus({ phase: 'inactive', receivedDocuments: 0, pendingChanges: 0 }));
  assert.equal(view.toJSON(), null, 'logout/guest does not display old account counts');
  assert.equal(h.calls.stops, 1);
  await unmount(view);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.motionListeners.size, 0);
});

test('pending/offline/error attention states keep static track and retry uses only the owner, including rejected retry promises', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = setup();
  h.setStatus({ phase: 'pending', receivedDocuments: 250, pendingChanges: 1 });
  h.setRetry(() => Promise.reject(new Error('owner updates its own failure snapshot')));
  const view = await mount(h.SyncStatusBanner);
  assert.equal(view.toJSON(), null, 'fresh pending changes do not show a toast immediately');
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS));
  assert.match(text(view), /Sincronización pendiente/);
  assert.match(text(view), /1 cambio pendiente/);
  assert.equal(h.calls.starts, 0);
  assert.equal(view.root.findAllByType('animated-track').length, 0);

  const button = byLabel(view, 'Reintentar sincronización');
  assert.equal(button.props.accessibilityRole, 'button');
  assert.equal(button.props.style({ pressed: false }).minHeight, 44);
  assert.equal(button.props.style({ pressed: false }).minWidth, 44);
  await renderer.act(async () => button.props.onPress());
  assert.equal(h.calls.retry, 1);
  assert.match(text(view), /Sincronización pendiente/, 'the view cannot declare success merely because retry was pressed');

  await renderer.act(async () => h.setStatus({ phase: 'offline', pendingChanges: 1 }));
  assert.match(text(view), /Sin conexión/);
  assert.ok(byLabel(view, 'Reintentar sincronización'));

  await renderer.act(async () => h.setStatus({ phase: 'error', error: 'download', pendingChanges: 0 }));
  assert.match(text(view), /No se pudo sincronizar/);
  assert.match(text(view), /No se completó la descarga/);
  assert.ok(byLabel(view, 'Reintentar sincronización'));
  assert.equal(h.calls.starts, 0);
  await unmount(view);
});

test('synced hides the toast and stops busy animation while attention states keep stable row height', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = setup();
  h.setStatus({ phase: 'syncing', receivedDocuments: 750, pendingChanges: 1 });
  const view = await mount(h.SyncStatusBanner);
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS));
  const rowHeight = byId(view, 'sync-status-banner').findAllByType('view').find(node => node.props.style?.minHeight === 44).props.style.minHeight;
  assert.equal(byId(view, 'sync-status-track').props.style.opacity, 1);

  await renderer.act(async () => h.setStatus({ phase: 'offline', pendingChanges: 1 }));
  assert.equal(byId(view, 'sync-status-track').props.style.opacity, 0);
  assert.ok(byId(view, 'sync-status-banner').findAllByType('view').some(node => node.props.style?.minHeight === rowHeight));

  const lastSyncedAt = Date.UTC(2026, 9, 29, 12, 0);
  await renderer.act(async () => h.setStatus({ phase: 'synced', pendingChanges: 0, lastSyncedAt }));
  assert.equal(view.toJSON(), null);
  assert.equal(h.calls.stops, 1);
  await unmount(view);
});

test('reduced motion is respected, changes stop animation and listeners/loops clean up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = setup({ reducedMotion: true });
  h.setStatus({ phase: 'syncing', receivedDocuments: 50, pendingChanges: 1 });
  const view = await mount(h.SyncStatusBanner);
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS));
  assert.equal(h.calls.starts, 0);
  assert.equal(typeof view.root.findByType('animated-track').props.style.transform[0].translateX, 'number');
  await renderer.act(async () => h.setMotion(false));
  assert.equal(h.calls.starts, 1);
  await renderer.act(async () => h.setMotion(true));
  assert.equal(h.calls.stops, 1);
  await renderer.act(async () => h.setMotion(false));
  assert.equal(h.calls.starts, 2);
  await unmount(view);
  assert.equal(h.calls.stops, 2);
  assert.equal(h.calls.motionRemoved, 1);
  assert.equal(h.motionListeners.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('a late preference query cannot override a newer reduced-motion event or animate after unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let resolve;
  const h = setup({ motionQuery: new Promise(done => { resolve = done; }) });
  h.setStatus({ phase: 'syncing', pendingChanges: 1 });
  const view = await mount(h.SyncStatusBanner);
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS));
  assert.equal(h.calls.starts, 0, 'unknown preference starts still');
  await renderer.act(async () => h.setMotion(true));
  await renderer.act(async () => resolve(false));
  assert.equal(h.calls.starts, 0);
  await unmount(view);
  h.setMotion(false);
  assert.equal(h.calls.starts, 0);
});

test('stale threshold starts at subscribe time and count changes do not reset the clock', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = setup();
  h.setStatus({ phase: 'syncing', pendingChanges: 2 });
  await renderer.act(async () => t.mock.timers.tick(300_000));

  // Clock starts when the first banner subscribes, not before mount.
  const view = await mount(h.SyncStatusBanner);
  assert.equal(view.toJSON(), null);

  await renderer.act(async () => t.mock.timers.tick(60_000));
  await renderer.act(async () => h.setStatus({ pendingChanges: 5 }));
  assert.equal(view.toJSON(), null, 'count changes while pending must not show prematurely');

  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS - 60_000 - 1));
  assert.equal(view.toJSON(), null, 'still hidden 1ms before threshold');

  await renderer.act(async () => t.mock.timers.tick(1));
  assert.match(text(view), /Sincronizando/, 'count changes did not reset the clock');

  await renderer.act(async () => h.setStatus({ phase: 'synced', pendingChanges: 0 }));
  assert.equal(view.toJSON(), null);

  await renderer.act(async () => h.setStatus({ phase: 'pending', pendingChanges: 1 }));
  assert.equal(view.toJSON(), null, 'pending reset to 0 cleared the stale clock');
  await renderer.act(async () => t.mock.timers.tick(h.STALE_PENDING_MS - 1));
  assert.equal(view.toJSON(), null);
  await renderer.act(async () => t.mock.timers.tick(1));
  assert.match(text(view), /Sincronización pendiente/);
  await unmount(view);
});

test('dismissal applies across mounted banners and re-shows on new reason or recurrence', async () => {
  const h = setup();
  h.setStatus({ phase: 'offline', pendingChanges: 1 });
  const first = await mount(h.SyncStatusBanner);
  const second = await mount(h.SyncStatusBanner);
  assert.match(text(first), /Sin conexión/);
  assert.match(text(second), /Sin conexión/);

  const close = byLabel(first, 'Ocultar estado de sincronización');
  assert.equal(close.props.accessibilityRole, 'button');
  assert.equal(close.props.style({ pressed: false }).width, 44);
  assert.equal(close.props.style({ pressed: false }).height, 44);
  await renderer.act(async () => close.props.onPress());
  assert.equal(first.toJSON(), null);
  assert.equal(second.toJSON(), null);

  // Different attention reason shows again on both screens.
  await renderer.act(async () => h.setStatus({ phase: 'error', error: 'download', pendingChanges: 1 }));
  assert.match(text(first), /No se pudo sincronizar/);
  assert.match(text(second), /No se pudo sincronizar/);

  await renderer.act(async () => byLabel(second, 'Ocultar estado de sincronización').props.onPress());
  assert.equal(first.toJSON(), null);
  assert.equal(second.toJSON(), null);

  // Different error code shows again.
  await renderer.act(async () => h.setStatus({ phase: 'error', error: 'upload' }));
  assert.match(text(first), /No se completó el envío/);
  await renderer.act(async () => byLabel(first, 'Ocultar estado de sincronización').props.onPress());
  assert.equal(first.toJSON(), null);

  // Recurrence after returning to a healthy state shows again.
  await renderer.act(async () => h.setStatus({ phase: 'synced', pendingChanges: 0, error: null }));
  assert.equal(first.toJSON(), null);
  await renderer.act(async () => h.setStatus({ phase: 'error', error: 'upload', pendingChanges: 0 }));
  assert.match(text(first), /No se pudo sincronizar/);
  assert.match(text(second), /No se pudo sincronizar/);

  await unmount(first);
  await unmount(second);
});

test('multiple mounted banners share a single owner subscription and clean up after the last unmount', async () => {
  const h = setup();
  const a = await mount(h.SyncStatusBanner);
  const b = await mount(h.SyncStatusBanner);
  const c = await mount(h.SyncStatusBanner);
  assert.equal(h.calls.subscribes, 1);
  assert.equal(h.listeners.size, 1);

  await unmount(a);
  await unmount(b);
  assert.equal(h.listeners.size, 1);

  await unmount(c);
  assert.equal(h.listeners.size, 0);
});

test('shared Screen renders banner as absolute sibling after safe-area with top inset without rerendering host per batch', async () => {
  const h = setup({ topInset: 47 });
  h.setStatus({ phase: 'error', error: 'connection', pendingChanges: 1 });
  const view = await mount(h.Screen, {}, React.createElement(h.NativeHost));
  const rootView = view.root.findByType('view');
  assert.deepEqual(rootView.children.map(node => node.type), ['safe-area', h.SyncStatusBanner]);
  const safeArea = view.root.findByType('safe-area');
  assert.deepEqual(safeArea.children.map(node => node.type), [h.NativeHost]);

  const toast = byId(view, 'sync-status-banner');
  assert.equal(toast.props.style.position, 'absolute');
  assert.equal(toast.props.style.top, 47);
  assert.equal(toast.props.style.left, 0);
  assert.equal(toast.props.style.right, 0);

  const initialRenders = h.calls.childRenders;
  await renderer.act(async () => h.setStatus({ receivedDocuments: 50 }));
  assert.match(text(view), /No se pudo sincronizar/);
  assert.equal(h.calls.childRenders, initialRenders, 'subscription belongs to the toast, not Screen or the Compose host');

  await renderer.act(async () => view.update(React.createElement(h.Screen, { edges: ['bottom'] }, React.createElement(h.NativeHost))));
  assert.equal(view.root.findAllByProps({ testID: 'sync-status-banner' }).length, 0);
  assert.equal(h.listeners.size, 0, 'bottom-only sheets do not subscribe');

  await renderer.act(async () => view.update(React.createElement(h.Screen, { safeArea: false }, React.createElement(h.NativeHost))));
  assert.equal(view.root.findAllByType('safe-area').length, 0);
  assert.equal(view.root.findAllByProps({ testID: 'sync-status-banner' }).length, 0);
  await unmount(view);
});

test('SSR snapshot is stable and inactive even when the process owner has account activity', () => {
  const owner = { getStatusSnapshot: () => ({ phase: 'syncing', receivedDocuments: 900 }), subscribeStatus() {} };
  let getServerSnapshot;
  const hook = compile('src/hooks/use-sync-status.ts', {
    react: { useSyncExternalStore(subscribe, getSnapshot, getServer) { getServerSnapshot = getServer; return getServer(); } },
    '@/services/sync/sync-client': { syncClient: owner },
  });
  const first = hook.useSyncStatus();
  assert.equal(first.phase, 'inactive');
  assert.equal(first.receivedDocuments, 0);
  assert.equal(hook.useSyncStatus(), first);
  assert.equal(getServerSnapshot(), first);
  assert.ok(Object.isFrozen(first));

  let bannerServerSnapshot;
  const banner = compile('src/components/sync/sync-status-banner.tsx', {
    react: {
      useSyncExternalStore(subscribe, getSnapshot, getServer) { bannerServerSnapshot = getServer; return getServer(); },
      useState: init => [typeof init === 'function' ? init() : init, () => {}],
      useEffect() {},
    },
    'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: 'view', Text: 'text', Pressable: 'pressable', AccessibilityInfo: {}, Easing: {}, Animated: { View: 'animated', Value: class {} } },
    '@/components/ui/Icon': { Icon: 'icon' },
    '@/services/sync/sync-client': { syncClient: { getStatusSnapshot: () => ({ phase: 'error', receivedDocuments: 10, pendingChanges: 1, lastSyncedAt: null, error: 'download' }), subscribeStatus() {} } },
    '@/theme': { useTheme: () => ({}) },
  });
  assert.equal(banner.SyncStatusBanner({}), null);
  const snap = bannerServerSnapshot();
  assert.equal(snap.visible, false);
  assert.equal(snap.attention, null);
  assert.equal(snap.status.phase, 'inactive');
  assert.equal(bannerServerSnapshot(), snap);
  assert.ok(Object.isFrozen(snap));
});
