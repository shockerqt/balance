import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const purePackage = '@balance/domain';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const read = (ref, path) => git('show', `${ref}:${path}`);
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;

export function nativeContract(ref) {
  const pkg = JSON.parse(read(ref, 'apps/mobile/package.json'));
  delete pkg.scripts;
  delete pkg.dependencies[purePackage];
  const lock = JSON.parse(read(ref, 'apps/mobile/package-lock.json'));
  delete lock.packages[''].dependencies[purePackage];
  for (const path of Object.keys(lock.packages)) {
    if (path === `node_modules/${purePackage}` || path === '../../packages/balance-domain') delete lock.packages[path];
  }
  const files = git('ls-tree', '-r', '--name-only', ref, '--', 'apps/mobile').split('\n')
    .filter(path => /^apps\/mobile\/(app\.(json|config\.[cm]?[jt]s)|eas\.json|android\/|ios\/|plugins\/|assets\/)/.test(path));
  const blobs = files.map(path => [path, git('rev-parse', `${ref}:${path}`)]);
  return createHash('sha256').update(JSON.stringify(sorted({ pkg, lock, blobs }))).digest('hex');
}

export function verifyPurePackage(ref) {
  const pkg = JSON.parse(read(ref, 'packages/balance-domain/package.json'));
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'scripts']) {
    const values = pkg[key] || {};
    if (key === 'scripts' ? Object.keys(values).some(name => /^(preinstall|install|postinstall|prepare)$/.test(name)) : Object.keys(values).length) {
      throw new Error(`Pure-domain exemption no longer valid: ${key}`);
    }
  }
  const files = git('ls-tree', '-r', '--name-only', ref, '--', 'packages/balance-domain').split('\n');
  if (files.some(path => /(?:app\.plugin|react-native\.config|\.podspec|\.gradle|\/android\/|\/ios\/)/.test(path))) {
    throw new Error('Pure-domain exemption contains native configuration');
  }
}

if (process.argv[1]?.endsWith('/native-compatibility.mjs')) {
  const baseline = JSON.parse(readFileSync('delivery/daily-runtime.json', 'utf8'));
  const ref = process.env.GITHUB_SHA || 'HEAD';
  verifyPurePackage(ref);
  if (nativeContract(ref) !== nativeContract(baseline.source_sha)) {
    throw new Error('NEW_APK_REQUIRED: native contract differs from the verified Daily build; build and validate an APK, then update delivery/daily-runtime.json in a reviewed PR.');
  }
  console.log(JSON.stringify({ compatible: true, source_sha: git('rev-parse', ref), build_id: baseline.build_id, runtime_version: baseline.runtime_version }));
}
