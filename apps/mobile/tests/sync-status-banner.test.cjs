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

function setup({ reducedMotion = false, motionQuery } = {}) {
  let snapshot = Object.freeze({ phase: 'inactive', receivedDocuments: 0, pendingChanges: 0, lastSyncedAt: null, error: null });
  const listeners = new Set(), motionListeners = new Set();
  const calls = { retry: 0, starts: 0, stops: 0, motionRemoved: 0, childRenders: 0 };
  let retry = () => Promise.resolve();
  const syncClient = {
    getStatusSnapshot: () => snapshot,
    subscribeStatus(listener) { listeners.add(listener); return () => listeners.delete(listener); },
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
  const theme = compile('src/theme/palettes.ts', { './tokens': tokens }).palettes.libroNoche;
  const owner = { syncClient };
  const hook = compile('src/hooks/use-sync-status.ts', { react: React, '@/services/sync/sync-client': owner });
  const banner = compile('src/components/sync/sync-status-banner.tsx', {
    ...common,
    'react-native': native,
    '@/components/ui/Icon': { Icon: props => React.createElement('icon', props) },
    '@/hooks/use-sync-status': hook,
    '@/services/sync/sync-client': owner,
    '@/theme': { useTheme: () => theme },
  });
  const screen = compile('src/components/ui/Screen.tsx', {
    ...common,
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'safe-area' },
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
const text = view => view.root.findAllByType('text').map(node => node.props.children).join(' ');
async function mount(Component, props, child) {
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(Component, props, child)); });
  return view;
}
async function unmount(view) { await renderer.act(async () => view.unmount()); }

test('real banner hides inactive/guest, renders actual received counts and never claims a total/percentage', async () => {
  const h = setup();
  const view = await mount(h.SyncStatusBanner);
  assert.equal(view.toJSON(), null);
  await renderer.act(async () => h.setStatus({ phase: 'connecting' }));
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

test('pending is static and retry uses only the owner, including rejected retry promises', async () => {
  const h = setup();
  h.setStatus({ phase: 'pending', receivedDocuments: 250, pendingChanges: 1 });
  h.setRetry(() => Promise.reject(new Error('owner updates its own failure snapshot')));
  const view = await mount(h.SyncStatusBanner);
  assert.match(text(view), /Sincronización pendiente/);
  assert.match(text(view), /1 cambio pendiente/);
  assert.equal(h.calls.starts, 0);
  assert.equal(view.root.findAllByType('animated-track').length, 0);
  const button = view.root.findByType('pressable');
  assert.equal(button.props.accessibilityRole, 'button');
  assert.equal(button.props.accessibilityLabel, 'Reintentar sincronización');
  assert.equal(button.props.style({ pressed: false }).minHeight, 44);
  assert.equal(button.props.style({ pressed: false }).minWidth, 44);
  await renderer.act(async () => button.props.onPress());
  assert.equal(h.calls.retry, 1);
  assert.match(text(view), /Sincronización pendiente/, 'the view cannot declare success merely because retry was pressed');
  await renderer.act(async () => h.setStatus({ phase: 'offline' }));
  assert.match(text(view), /Sin conexión/);
  await renderer.act(async () => h.setStatus({ phase: 'error', error: 'download' }));
  assert.match(text(view), /No se pudo sincronizar/);
  assert.match(text(view), /No se completó la descarga/);
  assert.equal(h.calls.starts, 0);
  await unmount(view);
});

test('synced shows check and last successful time with stable layout, rather than new progress', async () => {
  const h = setup();
  h.setStatus({ phase: 'syncing', receivedDocuments: 750 });
  const view = await mount(h.SyncStatusBanner);
  const rowHeight = byId(view, 'sync-status-banner').findAllByType('view').find(node => node.props.style?.minHeight === 44).props.style.minHeight;
  const lastSyncedAt = Date.UTC(2026, 9, 29, 12, 0);
  await renderer.act(async () => h.setStatus({ phase: 'synced', pendingChanges: 0, lastSyncedAt }));
  assert.match(text(view), /Actualizado/);
  assert.match(text(view), /750 registros recibidos/);
  assert.ok(text(view).includes(new Date(lastSyncedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })));
  assert.equal(view.root.findByType('icon').props.name, 'check');
  assert.equal(view.root.findAllByType('pressable').length, 0);
  assert.equal(byId(view, 'sync-status-track').props.style.opacity, 0);
  assert.ok(byId(view, 'sync-status-banner').findAllByType('view').some(node => node.props.style?.minHeight === rowHeight));
  assert.equal(h.calls.stops, 1);
  await unmount(view);
});

test('reduced motion is respected, changes stop animation and listeners/loops clean up', async () => {
  const h = setup({ reducedMotion: true });
  h.setStatus({ phase: 'syncing', receivedDocuments: 50 });
  const view = await mount(h.SyncStatusBanner);
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

test('a late preference query cannot override a newer reduced-motion event or animate after unmount', async () => {
  let resolve;
  const h = setup({ motionQuery: new Promise(done => { resolve = done; }) });
  h.setStatus({ phase: 'syncing' });
  const view = await mount(h.SyncStatusBanner);
  assert.equal(h.calls.starts, 0, 'unknown preference starts still');
  await renderer.act(async () => h.setMotion(true));
  await renderer.act(async () => resolve(false));
  assert.equal(h.calls.starts, 0);
  await unmount(view);
  h.setMotion(false);
  assert.equal(h.calls.starts, 0);
});

test('shared Screen inserts banner before the native host inside top safe area without rerendering that host per batch', async () => {
  const h = setup();
  h.setStatus({ phase: 'syncing' });
  const view = await mount(h.Screen, {}, React.createElement(h.NativeHost));
  const safeArea = view.root.findByType('safe-area');
  assert.deepEqual(safeArea.children.map(node => node.type), [h.SyncStatusBanner, h.NativeHost]);
  const initialRenders = h.calls.childRenders;
  await renderer.act(async () => h.setStatus({ receivedDocuments: 50 }));
  assert.match(text(view), /50 registros recibidos/);
  assert.equal(h.calls.childRenders, initialRenders, 'subscription belongs to the panel, not Screen or the Compose host');
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
});
