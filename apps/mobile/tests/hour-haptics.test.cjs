const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..'), local = Module.createRequire(path.join(root,'package.json')), ts = local('typescript');
function load(resolve) {
  const file=path.join(root,'src/lib/hour-haptics.ts'), m=new Module(file,module);m.filename=file;
  m.require=name=>{ assert.equal(name,'expo-haptics');return resolve(); };
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
  return m.exports.tickHourChange;
}
test('native package is lazy, unchanged/null hours do nothing and hour changes tick once', async()=>{
  let loads=0,ticks=0;const tick=load(()=>{loads++;return{selectionAsync:()=>{ticks++;return Promise.resolve();}};});
  assert.equal(loads,0);tick(null,null);tick(5,5);assert.equal(loads,0);
  tick(null,5);tick(5,6);tick(6,6);tick(6,null);await Promise.resolve();
  assert.equal(loads,1);assert.equal(ticks,2);
});
test('old APK missing ExpoHaptics never crashes or retries resolution per hour',()=>{
  let loads=0;const tick=load(()=>{loads++;throw Error('Cannot find native module ExpoHaptics');});
  assert.doesNotThrow(()=>{tick(null,5);tick(5,6);});assert.equal(loads,1);
});
test('sync throws, malformed module and rejected native feedback never escape JS',async()=>{
  for(const native of [{},{selectionAsync(){throw Error('disabled');}},{selectionAsync:()=>Promise.reject(Error('unsupported'))}]){
    const tick=load(()=>native);assert.doesNotThrow(()=>tick(null,5));await new Promise(resolve=>setImmediate(resolve));
  }
});
