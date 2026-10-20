import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { getRoutes } = require('expo-router/build/getRoutesCore');
const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig');
const app = new URL('../src/app/', import.meta.url);
const keys = readdirSync(app, { recursive: true })
  .filter(name => name.endsWith('.tsx')).map(name => `./${name}`);
const context = () => ({ default: () => null });
context.keys = () => keys;
const config = getReactNavigationConfig(getRoutes(context, {
  platform: 'android', importMode: 'lazy', ignoreEntryPoints: true,
}), true);

// Exercise Expo's real path matcher without importing the native runtime in Node.
// Only the platform module's config validator is replaced; routing and query
// decoding are the installed SDK implementation.
const matcherPath = require.resolve('expo-router/build/fork/getStateFromPath');
const matcherRequire = createRequire(matcherPath);
const matcher = { exports: {} };
runInNewContext(readFileSync(matcherPath, 'utf8'), {
  module: matcher, exports: matcher.exports, console, process,
  require: name => name === '../react-navigation/native'
    ? { validatePathConfig() {} } : matcherRequire(name),
});
const { getStateFromPath } = matcher.exports;

for (const path of ['auth-callback', 'auth-callback/dev', 'auth-callback/daily']) {
  test(`Android OAuth return resolves ${path} without a not-found screen`, () => {
    const state = getStateFromPath(`/${path}?code=synthetic-code&state=synthetic-state&iss=https%3A%2F%2Fauth.shocker.cl`, config);
    const route = state.routes.at(-1);
    assert.equal(route.name, path);
    assert.equal(route.params.code, 'synthetic-code');
    assert.equal(route.params.state, 'synthetic-state');
    assert.equal(route.params.iss, 'https://auth.shocker.cl');
  });
}

test('variant routes reuse the existing callback screen and AuthSession owner', () => {
  for (const variant of ['dev', 'daily']) {
    const aliasPath = new URL(`auth-callback/${variant}.tsx`, app);
    const ts = require('typescript');
    const code = ts.transpileModule(readFileSync(aliasPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const original = { __esModule: true, default: () => null };
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, require(name) {
      assert.equal(fileURLToPath(new URL(`${name}.tsx`, aliasPath)), fileURLToPath(new URL('auth-callback.tsx', app)));
      return original;
    } });
    assert.equal(module.exports.default, original.default);
  }
});
