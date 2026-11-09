const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const assert = require('node:assert/strict'), test = require('node:test');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript'), React = local('react'), renderer = local('react-test-renderer');
const trace = local('./src/dev/native-pager-status.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
async function harness({ embedded = false, enabled = true, pending = true } = {}) {
  const shares = [];
  const currentId = '00000000-0000-4000-8000-000000000001', downloadedId = '00000000-0000-4000-8000-000000000002';
  const filename = path.join(root, 'src/components/updates/update-information.tsx');
  const stubs = {
    react: React, 'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': { View: host('View'), Share: { share: async value => shares.push(value) } },
    'expo-updates': { __esModule: true, isEnabled: enabled, updateId: enabled ? currentId : null, channel: 'daily', runtimeVersion: '1.9.0',
      useUpdates: () => ({ currentlyRunning: { updateId: enabled ? currentId : undefined, channel: 'daily', runtimeVersion: '1.9.0', isEmbeddedLaunch: embedded, isEmergencyLaunch: false },
        downloadedUpdate: pending ? { updateId: downloadedId } : undefined, isUpdatePending: pending }) },
    '@/components/ui': Object.fromEntries(['Button','Card','Text'].map(name => [name, host(name)])),
    '@/dev/native-pager-status': trace,
  };
  const m = new Module(filename, module); m.filename = filename;
  m.require = name => { if (name in stubs) return stubs[name]; throw Error('Unexpected dependency ' + name); };
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  let view; await renderer.act(async () => { view = renderer.create(React.createElement(m.exports.UpdateInformation)); });
  const text = () => view.root.findAllByType('Text').map(node => React.Children.toArray(node.props.children).filter(v => typeof v === 'string' || typeof v === 'number').join('')).join('\n');
  return { view, shares, text, currentId, downloadedId,
    async press(title) { await renderer.act(async () => { await view.root.findAllByType('Button').find(node => node.props.title === title).props.onPress(); }); },
    async close() { await renderer.act(async () => view.unmount()); },
  };
}

test('the visible running OTA identifier is distinct from the downloaded pending update', async () => {
  trace.resetNativePagerStatus();
  const h = await harness();
  try {
    const code = h.view.root.findAllByType('Text').find(node => node.props.accessibilityLabel === 'Código de la actualización en ejecución');
    assert.equal(code.props.children, h.currentId); assert.notEqual(code.props.children, h.downloadedId);
    assert.match(h.text(), /OTA aplicada/); assert.match(h.text(), new RegExp(h.downloadedId));
    assert.equal(h.shares.length, 0, 'rendering does not share or transmit a diagnostic');
    trace.recordNativePagerEvent('selected', { index: 8 }); trace.recordNativePagerEvent('state', { phase: 'idle' }); trace.recordNativePagerEvent('rejected', { reason: 'revision', revision: 2, expected: 1 });
    await h.press('Ver diagnóstico del deslizamiento'); assert.match(h.text(), /selected=1 state=1/);
    await h.press('Compartir diagnóstico');
    assert.equal(h.shares.length, 1); assert.match(h.shares[0].message, new RegExp(h.currentId)); assert.match(h.shares[0].message, /Origen: OTA aplicada/); assert.match(h.shares[0].message, /revision/);
  } finally { await h.close(); }
});

test('embedded launch and disabled OTA are labelled without claiming a downloaded update is running', async () => {
  const embedded = await harness({ embedded: true, pending: false });
  try { assert.match(embedded.text(), /Incluida en la APK/); assert.doesNotMatch(embedded.text(), /OTA aplicada/); }
  finally { await embedded.close(); }
  const disabled = await harness({ enabled: false, pending: false });
  try { assert.match(disabled.text(), /OTA desactivada/); assert.doesNotMatch(disabled.text(), /OTA aplicada/); }
  finally { await disabled.close(); }
});

test('the pager trace is bounded, immutable across snapshots and excludes undeclared data fields', () => {
  trace.resetNativePagerStatus(); const initial = trace.getNativePagerStatus(); let notices = 0;
  const unsubscribe = trace.subscribeNativePagerStatus(() => notices++);
  for (let i = 0; i < 100; i++) trace.recordNativePagerEvent('selected', { index: i % 15, authorization: 'secret', date: 'private-date', foods: ['private-food'] });
  unsubscribe();
  const value = trace.getNativePagerStatus(); assert.equal(value.events.length, 16); assert.equal(value.counts.selected, 100); assert.equal(notices, 100); assert.equal(initial.events.length, 0);
  const output = trace.nativePagerStatusText(value);
  assert.doesNotMatch(output, /secret|private-date|private-food|authorization/);
  trace.recordNativePagerEvent('selected', { index: NaN }); assert.equal(notices, 100);
});
