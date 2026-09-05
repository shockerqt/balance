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
