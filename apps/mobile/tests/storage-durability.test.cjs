const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const sourceRoot = path.resolve(__dirname, '../src/services');
const owner = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(sourceRoot, 'sync/sync-client.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: owner, exports: owner.exports,
  require(name) {
    if (name === 'react-native') return { AppState: { addEventListener() {} } };
    if (name === '@/services/config' || name === '@/services/auth/session-state' || name === './types') return {};
    if (name === '@/services/storage') return { storage: {} };
    throw new Error(`Unexpected owner dependency ${name}`);
  },
}, { filename: 'sync-client.ts' });
const keys = {
  // Exercise the canonical owner's exported key, not an invented fixture prefix.
  cache: owner.exports.collectionStorageKey('user:synthetic', 'mealLogs'),
  checkpoint: '@balance_sync_checkpoint_v2:user:synthetic:mealLogs',
  outbox: '@balance_sync_outbox_v2:user:synthetic',
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function physicalStore() {
  return { files: new Map(), legacy: new Map(), web: new Map(), controls: {}, writes: [], moves: [], nativeWrites: [], removals: [], sequence: 0 };
}

// Only platform storage primitives are mocked. Each load recreates the actual
// adapter/helper modules, including their volatile Maps, as a process restart.
function restart(physical, platform = 'android', { webAvailable = true } = {}) {
  const loaded = new Map();
  const native = {
    async getItem(key) { await physical.controls.legacyRead?.(key); return physical.legacy.get(key) ?? null; },
    async setItem(key, value) {
      await physical.controls.legacyWrite?.(key, value);
      if (value.length > 2 * 1024 * 1024) throw new Error('synthetic per-value native limit');
      physical.nativeWrites.push(key);
      physical.legacy.set(key, value);
    },
    async removeItem(key) { await physical.controls.legacyRemove?.(key); physical.legacy.delete(key); },
    async multiSet(entries) { for (const [key, value] of entries) await native.setItem(key, value); },
  };
  const files = {
    documentDirectory: 'file:///documents/',
    EncodingType: { UTF8: 'utf8' },
    async getInfoAsync(uri) { await physical.controls.fileInfo?.(uri); return { exists: physical.files.has(uri) }; },
    async readAsStringAsync(uri) {
      await physical.controls.fileRead?.(uri);
      if (!physical.files.has(uri)) throw new Error('synthetic missing file');
      return physical.files.get(uri);
    },
    async makeDirectoryAsync() { await physical.controls.directory?.(); },
    async writeAsStringAsync(uri, value, options) {
      assert.equal(options.encoding, 'utf8');
      assert.equal(options.append, false);
      await physical.controls.fileWrite?.(uri, value);
      // Model SDK57's iOS Data.write(.atomic): failures leave old bytes intact.
      physical.files.set(uri, value);
      physical.writes.push(uri);
    },
    async moveAsync({ from, to }) {
      assert.equal(platform, 'android', 'iOS move removes its destination first and must never be used');
      assert.equal(from.slice(0, from.lastIndexOf('/')), to.slice(0, to.lastIndexOf('/')));
      await physical.controls.move?.(from, to);
      assert.ok(physical.files.has(from));
      physical.files.set(to, physical.files.get(from));
      physical.files.delete(from);
      physical.moves.push({ from, to });
    },
    async deleteAsync(uri) { await physical.controls.fileDelete?.(uri); physical.files.delete(uri); physical.removals.push(uri); },
  };
  const web = {
    getItem(key) { physical.controls.webRead?.(key); return physical.web.get(key) ?? null; },
    setItem(key, value) { physical.controls.webWrite?.(key, value); physical.web.set(key, value); },
    removeItem(key) { physical.controls.webRemove?.(key); physical.web.delete(key); },
  };
  function load(relative) {
    if (loaded.has(relative)) return loaded.get(relative).exports;
    const module = { exports: {} };
    loaded.set(relative, module);
    const filename = path.join(sourceRoot, `${relative}.ts`);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports,
      window: platform === 'web' && webAvailable ? { localStorage: web } : undefined,
      require(name) {
        if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: native };
        if (name === 'react-native') return { Platform: { OS: platform } };
        if (name === 'expo-file-system/legacy') return files;
        if (name === 'expo-crypto') return {
          CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
          async digestStringAsync(algorithm, value) { assert.equal(algorithm, 'SHA-256'); return crypto.createHash('sha256').update(value).digest('hex'); },
          randomUUID() { return `00000000-0000-4000-8000-${String(++physical.sequence).padStart(12, '0')}`; },
        };
        if (name.startsWith('./')) return load(name.slice(2));
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename });
    return module.exports;
  }
  return load('storage').storage;
}

const finalFiles = physical => [...physical.files.keys()].filter(uri => uri.endsWith('.json'));

test('large native sync values survive a process restart without SQLite limits or RAM acknowledgement', async () => {
  const physical = physicalStore();
  const storage = restart(physical);
  const large = JSON.stringify({ synthetic: 'x'.repeat(7 * 1024 * 1024) });
  await storage.setItem(keys.cache, large);
  await storage.setItem(keys.checkpoint, '{"updatedAt":1,"id":"synthetic"}');
  assert.equal(storage.isDurableItem(keys.cache), true);
  assert.equal(physical.nativeWrites.length, 0);
  assert.equal(physical.moves.length, 2);
  assert.equal([...physical.files.keys()].some(uri => uri.endsWith('.tmp')), false);
  const next = restart(physical);
  assert.equal(next.isDurableItem(keys.cache), false);
  assert.equal(await next.getItem(keys.cache), large);
  assert.equal(next.isDurableItem(keys.cache), true);
  assert.equal(await next.getItem(keys.checkpoint), '{"updatedAt":1,"id":"synthetic"}');
});

test('legacy valid partial cache and outbox remain readable without certifying legacy cache as complete', async () => {
  const physical = physicalStore();
  physical.legacy.set(keys.cache, '[{"id":"old-partial"}]');
  physical.legacy.set(keys.checkpoint, '{"updatedAt":999,"id":"final-cursor"}');
  physical.legacy.set(keys.outbox, '[{"syntheticPending":true}]');
  const storage = restart(physical);
  assert.equal(await storage.getItem(keys.cache), '[{"id":"old-partial"}]');
  assert.equal(await storage.getItem(keys.outbox), '[{"syntheticPending":true}]');
  assert.equal(storage.isDurableItem(keys.cache), false);
  assert.equal(storage.isDurableItem(keys.outbox), false);
  assert.equal(physical.files.size, 0, 'a read must not silently migrate a partial cache into a durability proof');
  await storage.setItem(keys.cache, '[{"id":"replayed"}]');
  const next = restart(physical);
  assert.equal(await next.getItem(keys.cache), '[{"id":"replayed"}]');
  assert.equal(next.isDurableItem(keys.cache), true);
  assert.equal(physical.legacy.get(keys.outbox), '[{"syntheticPending":true}]');
});

test('durable null tombstones prevent legacy resurrection after removal and restart', async () => {
  const physical = physicalStore();
  for (const key of Object.values(keys)) physical.legacy.set(key, 'old-legacy-value');
  const storage = restart(physical);
  for (const key of Object.values(keys)) await storage.removeItem(key);
  const next = restart(physical);
  for (const key of Object.values(keys)) {
    assert.equal(await next.getItem(key), null);
    assert.equal(next.isDurableItem(key), true);
    assert.equal(physical.legacy.get(key), 'old-legacy-value');
  }
});

test('per-key writes and reads are ordered, while unrelated collection writes can proceed', async () => {
  const physical = physicalStore();
  const gate = deferred(), entered = deferred();
  physical.controls.fileWrite = async (uri, value) => {
    if (JSON.parse(value).value === 'first') { entered.resolve(); await gate.promise; }
  };
  const storage = restart(physical);
  const first = storage.setItem(keys.cache, 'first');
  await entered.promise;
  const second = storage.setItem(keys.cache, 'second');
  let readComplete = false;
  const read = storage.getItem(keys.cache).then(value => { readComplete = true; return value; });
  await storage.setItem(keys.outbox, 'different key');
  assert.equal(readComplete, false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(await read, 'second');
  assert.equal(await restart(physical).getItem(keys.cache), 'second');
});

test('Android failed write/move rejects, preserves old committed bytes and recovers on a later write', async () => {
  const physical = physicalStore();
  const storage = restart(physical);
  await storage.setItem(keys.cache, 'old');
  physical.controls.move = () => { throw new Error('private platform detail'); };
  await assert.rejects(storage.setItem(keys.cache, 'new'), /SYNC_STORAGE_WRITE_FAILED/);
  assert.equal(storage.isDurableItem(keys.cache), false);
  assert.equal(await restart(physical).getItem(keys.cache), 'old');
  assert.equal([...physical.files.keys()].some(uri => uri.endsWith('.tmp')), false);
  delete physical.controls.move;
  physical.controls.fileWrite = () => { throw new Error('synthetic disk full'); };
  await assert.rejects(storage.setItem(keys.cache, 'another'), /SYNC_STORAGE_WRITE_FAILED/);
  delete physical.controls.fileWrite;
  await storage.setItem(keys.cache, 'recovered');
  assert.equal(await restart(physical).getItem(keys.cache), 'recovered');
});

test('concurrent first writes share directory creation and a failed creation can be retried', async () => {
  const physical = physicalStore();
  const gate = deferred(), entered = deferred();
  let creates = 0;
  physical.controls.directory = async () => {
    creates++;
    if (creates > 1) throw new Error('synthetic native concurrent mkdir race');
    entered.resolve();
    await gate.promise;
  };
  const storage = restart(physical);
  const cache = storage.setItem(keys.cache, 'cache');
  await entered.promise;
  const queue = storage.setItem(keys.outbox, 'pending');
  gate.resolve();
  await Promise.all([cache, queue]);
  assert.equal(creates, 1);
  const failing = physicalStore();
  failing.controls.directory = () => { throw new Error('synthetic mkdir failure'); };
  const retry = restart(failing);
  await assert.rejects(retry.setItem(keys.cache, 'not written'), /SYNC_STORAGE_WRITE_FAILED/);
  delete failing.controls.directory;
  await retry.setItem(keys.cache, 'recovered');
  assert.equal(await restart(failing).getItem(keys.cache), 'recovered');
});

test('iOS uses the installed atomic UTF8 writer, never delete-then-move, and retains old bytes on failure', async () => {
  const physical = physicalStore();
  const storage = restart(physical, 'ios');
  await storage.setItem(keys.outbox, 'old-pending');
  physical.controls.fileWrite = () => { throw new Error('synthetic atomic failure'); };
  await assert.rejects(storage.setItem(keys.outbox, 'new-pending'), /SYNC_STORAGE_WRITE_FAILED/);
  delete physical.controls.fileWrite;
  assert.equal(await restart(physical, 'ios').getItem(keys.outbox), 'old-pending');
  assert.equal(physical.moves.length, 0);
  assert.equal(physical.removals.length, 0);
  assert.ok(physical.writes.every(uri => uri.endsWith('.json')));
});

test('cache corruption/read failure permits replay without deleting data; outbox/checkpoint failures are explicit', async () => {
  const physical = physicalStore();
  const storage = restart(physical);
  await storage.setItem(keys.cache, 'valid');
  physical.files.set(finalFiles(physical)[0], '{corrupt');
  assert.equal(await storage.getItem(keys.cache), null);
  assert.equal(storage.isDurableItem(keys.cache), false);
  assert.equal(physical.files.size, 1, 'corrupt bytes are not destructively cleared');
  await storage.setItem(keys.outbox, 'pending');
  await storage.setItem(keys.checkpoint, 'cursor');
  physical.controls.fileRead = () => { throw new Error('private read error'); };
  await assert.rejects(storage.getItem(keys.outbox), /SYNC_STORAGE_READ_FAILED/);
  await assert.rejects(storage.getItem(keys.checkpoint), /SYNC_STORAGE_READ_FAILED/);
  assert.equal(await storage.getItem(keys.cache), null);
  const noFiles = physicalStore();
  noFiles.controls.legacyRead = () => { throw new Error('synthetic unavailable legacy storage'); };
  const legacy = restart(noFiles);
  assert.equal(await legacy.getItem(keys.cache), null);
  await assert.rejects(legacy.getItem(keys.outbox), /SYNC_STORAGE_READ_FAILED/);
});

test('failed removal cannot acknowledge a lost outbox or resurrect legacy work', async () => {
  const physical = physicalStore();
  const storage = restart(physical);
  physical.legacy.set(keys.outbox, 'older legacy');
  await storage.setItem(keys.outbox, 'current pending');
  physical.controls.move = () => { throw new Error('synthetic rename failure'); };
  await assert.rejects(storage.removeItem(keys.outbox), /SYNC_STORAGE_WRITE_FAILED/);
  assert.equal(await restart(physical).getItem(keys.outbox), 'current pending');
});

test('web sync operations require a working durable backend and never fall through to memory', async () => {
  const physical = physicalStore();
  const storage = restart(physical, 'web');
  await storage.setItem(keys.cache, 'web cache');
  assert.equal(await restart(physical, 'web').getItem(keys.cache), 'web cache');
  assert.equal(storage.isDurableItem(keys.cache), true);
  physical.controls.webWrite = () => { throw new Error('synthetic quota'); };
  await assert.rejects(storage.setItem(keys.cache, 'not durable'), /SYNC_STORAGE_WRITE_FAILED/);
  assert.equal(storage.isDurableItem(keys.cache), false);
  assert.equal(await restart(physical, 'web').getItem(keys.cache), 'web cache');
  const unavailable = restart(physical, 'web', { webAvailable: false });
  await assert.rejects(unavailable.setItem(keys.cache, 'no backend'), /SYNC_STORAGE_WRITE_FAILED/);
  await assert.rejects(unavailable.getItem(keys.outbox), /SYNC_STORAGE_READ_FAILED/);
  assert.equal(physical.files.size, 0);
});

test('non-sync keys keep their existing fallback contract and sync filenames are bounded opaque hashes', async () => {
  const physical = physicalStore();
  const original = restart(physical);
  await original.setItem('non-sync-persistent', 'original backend');
  assert.equal(await restart(physical).getItem('non-sync-persistent'), 'original backend');
  physical.controls.legacyWrite = () => { throw new Error('synthetic native unavailable'); };
  const storage = restart(physical);
  await storage.setItem('@balance_theme_v1', 'dark');
  assert.equal(await storage.getItem('@balance_theme_v1'), 'dark');
  assert.equal(storage.isDurableItem('@balance_theme_v1'), false);
  await storage.multiSet([['local-one', '1'], ['local-two', '2']]);
  assert.equal(await storage.getItem('local-one'), '1');
  const longKey = owner.exports.collectionStorageKey(`user:${'synthetic:namespace/'.repeat(1000)}`, 'mealLogs');
  await storage.multiSet([[longKey, 'large namespace'], [keys.outbox, 'pending']]);
  for (const uri of finalFiles(physical)) assert.match(uri, /^file:\/\/\/documents\/balance-sync-v1\/[a-f0-9]{64}\.json$/);
  assert.equal(await restart(physical).getItem(longKey), 'large namespace');
  assert.equal(await restart(physical).getItem('@balance_theme_v1'), null, 'legacy non-sync RAM fallback remains deliberately process-local');
});
