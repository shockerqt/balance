const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/dev/react-native-spike-gate.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function enabled(variant, switchValue) {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: name => { assert.equal(name, 'expo-constants'); return { expoConfig: { extra: { appVariant: variant } } }; },
    process: { env: { EXPO_PUBLIC_BALANCE_RN_SPIKE: switchValue } } });
  return module.exports.reactNativeSpikeEnabled;
}
test('minified development needs the explicit switch; Daily and production always deny the spike', () => {
  assert.equal(enabled('development', '1'), true);
  for (const variant of ['daily', 'production', undefined]) assert.equal(enabled(variant, '1'), false);
  for (const value of [undefined, '0', 'true']) assert.equal(enabled('development', value), false);
});
