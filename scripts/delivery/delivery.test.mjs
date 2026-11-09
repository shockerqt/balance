import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUpdate } from './verify-update.mjs';
import { nativeContract, verifyPurePackage } from './native-compatibility.mjs';
const sha = 'a'.repeat(40);
const update = { platform: 'android', runtimeVersion: '1.1.0', id: 'update-id', group: 'group-id', message: `main ${sha}` };
test('delivery receipt binds update, source and runtime', () => {
  assert.equal(verifyUpdate([update], sha, '1.1.0').group_id, 'group-id');
  for (const invalid of [[], [update, update], [{...update, platform: 'ios'}], [{...update, runtimeVersion: '2.0'}], [{...update, message: 'other commit'}]]) {
    assert.throws(() => verifyUpdate(invalid, sha, '1.1.0'));
  }
});
test('BAL-032 pure extraction preserves installed native contract', () => {
  assert.equal(nativeContract('bbf0240a38e7009d3c70c9c5487a9a8ef9eb666f'), nativeContract('7ae6a421574b17913e7a950fd777afb0d03f4ed2'));
  assert.doesNotThrow(() => verifyPurePackage('7ae6a421574b17913e7a950fd777afb0d03f4ed2'));
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('native dependency and config changes invalidate compatibility', () => {
  const original = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'balance-native-'));
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    process.chdir(temp);
    git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    mkdirSync('apps/mobile', { recursive: true });
    const pkg = { dependencies: { expo: '57.0.0' } };
    writeFileSync('apps/mobile/package.json', JSON.stringify(pkg));
    writeFileSync('apps/mobile/package-lock.json', JSON.stringify({ packages: { '': pkg } }));
    writeFileSync('apps/mobile/app.json', JSON.stringify({ expo: { version: '1.0.0' } }));
    git('add', '.'); git('commit', '-m', 'baseline');
    const baseline = nativeContract('HEAD');
    writeFileSync('apps/mobile/app.json', JSON.stringify({ expo: { version: '2.0.0' } }));
    git('add', '.'); git('commit', '-m', 'native runtime change');
    assert.notEqual(nativeContract('HEAD'), baseline);
    const next = nativeContract('HEAD');
    pkg.dependencies['native-module'] = '1.0.0';
    writeFileSync('apps/mobile/package.json', JSON.stringify(pkg));
    git('add', '.'); git('commit', '-m', 'new native dependency');
    assert.notEqual(nativeContract('HEAD'), next);
  } finally { process.chdir(original); rmSync(temp, { recursive: true, force: true }); }
});

import { readFileSync } from 'node:fs';
const reviewedRenderer = JSON.parse(readFileSync(new URL('./fixtures/pr-59-test-renderer.json', import.meta.url)));
test('verified PR #59 test dependency passes without hiding APK-requiring changes', () => {
  const original = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'balance-test-dependency-'));
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, value) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    process.chdir(temp);
    git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    const basePkg = { dependencies: { expo: '57.0.0', react: '19.2.3' }, devDependencies: { typescript: '~6.0.3' } };
    const baseLock = { lockfileVersion: 3, packages: {
      '': structuredClone(basePkg),
      'node_modules/react-is': { version: '19.2.3' },
      'node_modules/scheduler': { version: '0.27.0' },
    } };
    write('apps/mobile/package.json', basePkg);
    write('apps/mobile/package-lock.json', baseLock);
    write('apps/mobile/app.json', { expo: { version: '1.0.0' } });
    git('add', '.'); git('commit', '-m', 'baseline');
    const baseline = nativeContract('HEAD');
    const pkg = structuredClone(basePkg), lock = structuredClone(baseLock);
    pkg.devDependencies['react-test-renderer'] = '^19.2.3';
    lock.packages[''].devDependencies['react-test-renderer'] = '^19.2.3';
    lock.packages['node_modules/react-test-renderer'] = structuredClone(reviewedRenderer);
    write('apps/mobile/package.json', pkg); write('apps/mobile/package-lock.json', lock);
    git('add', '.'); git('commit', '-m', 'verified test renderer');
    const allowed = git('rev-parse', 'HEAD');
    assert.equal(nativeContract(allowed), baseline);
    const cases = [
      ['runtime dependency', (p) => { p.dependencies['react-test-renderer'] = '^19.2.3'; }],
      ['optional dependency', (p) => { p.optionalDependencies = { 'react-test-renderer': '^19.2.3' }; }],
      ['different version', (_, l) => { l.packages['node_modules/react-test-renderer'].version = '19.2.4'; }],
      ['different integrity', (_, l) => { l.packages['node_modules/react-test-renderer'].integrity = 'changed'; }],
      ['install hook', (_, l) => { l.packages['node_modules/react-test-renderer'].hasInstallScript = true; }],
      ['not dev only', (_, l) => { delete l.packages['node_modules/react-test-renderer'].dev; }],
      ['inconsistent root', (_, l) => { delete l.packages[''].devDependencies['react-test-renderer']; }],
      ['new transitive dependency', (_, l) => { l.packages['node_modules/new-native-module'] = { version: '1.0.0', dev: true }; }],
      ['shared transitive change', (_, l) => { l.packages['node_modules/scheduler'].version = '0.28.0'; }],
      ['unreviewed dev dependency', (p) => { p.devDependencies['native-config-plugin'] = '1.0.0'; }],
      ['native config', () => write('apps/mobile/app.json', { expo: { version: '2.0.0' } })],
      ['asset', () => write('apps/mobile/assets/icon.png', 'changed asset')],
      ['native code', () => write('apps/mobile/android/app/build.gradle', 'native change')],
      ['local Kotlin view', () => write('apps/mobile/modules/daily/android/src/main/java/Daily.kt', 'class Daily')],
      ['local module autolinking', () => write('apps/mobile/modules/daily/expo-module.config.json', '{"platforms":["android"]}')],
      ['local module Gradle', () => write('apps/mobile/modules/daily/android/build.gradle', 'implementation native')],
      ['config plugin', () => write('apps/mobile/plugins/with-native.cjs', 'module.exports = {};')],
    ];
    for (const [name, mutate] of cases) {
      git('reset', '--hard', allowed); git('clean', '-fd');
      const candidatePkg = structuredClone(pkg), candidateLock = structuredClone(lock);
      mutate(candidatePkg, candidateLock);
      write('apps/mobile/package.json', candidatePkg); write('apps/mobile/package-lock.json', candidateLock);
      git('add', '.'); git('commit', '-m', name);
      assert.notEqual(nativeContract('HEAD'), baseline, name);
    }
  } finally { process.chdir(original); rmSync(temp, { recursive: true, force: true }); }
});

const reviewedLists = JSON.parse(readFileSync(new URL('./fixtures/bal-048-pure-lists.json', import.meta.url)));
test('BAL-048 exact pure-JS list archives preserve the APK contract and changed native/dependency inputs fail closed', () => {
  const original = process.cwd(), temp = mkdtempSync(join(tmpdir(), 'balance-pure-lists-'));
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    process.chdir(temp); git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    const basePkg = { dependencies: { expo: '57.0.0', react: '19.2.3' }, devDependencies: { typescript: '~6.0.3' } };
    const baseLock = { lockfileVersion: 3, packages: { '': structuredClone(basePkg), 'node_modules/react-native': { version: '0.86.2' } } };
    write('apps/mobile/package.json', basePkg); write('apps/mobile/package-lock.json', baseLock); write('apps/mobile/app.json', { expo: { version: '1.9.0' } });
    git('add', '.'); git('commit', '-m', 'baseline'); const baseline = nativeContract('HEAD');
    const pkg = structuredClone(basePkg), lock = structuredClone(baseLock);
    Object.assign(pkg.dependencies, reviewedLists.dependencies); Object.assign(lock.packages[''].dependencies, reviewedLists.dependencies);
    Object.assign(lock.packages, structuredClone(reviewedLists.packages));
    write('apps/mobile/package.json', pkg); write('apps/mobile/package-lock.json', lock);
    git('add', '.'); git('commit', '-m', 'audited JS lists'); const allowed = git('rev-parse', 'HEAD');
    assert.equal(nativeContract(allowed), baseline);
    const cases = [
      ['unpinned version', p => { p.dependencies['@legendapp/list'] = '^3.7.1'; }],
      ['manifest mismatch', (_, l) => { delete l.packages[''].dependencies['@shopify/flash-list']; }],
      ['new list version', (_, l) => { l.packages['node_modules/@legendapp/list'].version = '3.7.2'; }],
      ['new archive', (_, l) => { l.packages['node_modules/@shopify/flash-list'].integrity = 'changed'; }],
      ['new registry', (_, l) => { l.packages['node_modules/@legendapp/list'].resolved = 'https://example.invalid/list.tgz'; }],
      ['install hook', (_, l) => { l.packages['node_modules/@legendapp/list'].hasInstallScript = true; }],
      ['changed dependency', (_, l) => { l.packages['node_modules/@legendapp/list'].dependencies.native = '1'; }],
      ['changed peer', (_, l) => { l.packages['node_modules/@shopify/flash-list'].peerDependencies['react-native'] = 'other'; }],
      ['shim version', (_, l) => { l.packages['node_modules/use-sync-external-store'].version = '1.8.0'; }],
      ['shim metadata', (_, l) => { l.packages['node_modules/use-sync-external-store'].optional = true; }],
      ['new nested native module', (_, l) => { l.packages['node_modules/@legendapp/list/node_modules/native'] = { version: '1' }; }],
      ['changed shared native dependency', (_, l) => { l.packages['node_modules/react-native'].version = '0.87.0'; }],
      ['additional root dependency', p => { p.dependencies.native = '1'; }],
      ['native config', () => write('apps/mobile/app.json', { expo: { version: '2.0.0' } })],
      ['local module removal', () => write('apps/mobile/modules/daily/expo-module.config.json', '{"platforms":[]}')],
      ['native source', () => write('apps/mobile/modules/daily/android/src/main/java/Daily.kt', 'class Daily')],
      ['config plugin', () => write('apps/mobile/plugins/native.cjs', 'module.exports = {};')],
      ['asset', () => write('apps/mobile/assets/icon.png', 'changed')],
    ];
    for (const [name, mutate] of cases) {
      git('reset', '--hard', allowed); git('clean', '-fd');
      const p = structuredClone(pkg), l = structuredClone(lock); mutate(p, l);
      write('apps/mobile/package.json', p); write('apps/mobile/package-lock.json', l);
      git('add', '.'); git('commit', '-m', name);
      assert.notEqual(nativeContract('HEAD'), baseline, name);
    }
  } finally { process.chdir(original); rmSync(temp, { recursive: true, force: true }); }
});
