const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),test=require('node:test');
const root=path.resolve(__dirname,'..'),local=Module.createRequire(path.join(root,'package.json'));
const ts=local('typescript'),React=local('react'),renderer=local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const file=path.join(root,'src/theme/ThemeProvider.tsx');
let load, stored=[],foreground,scheme='dark',mounts=0,unmounts=0,controls,lastTheme;
const storage={getItem:key=>key==='@balance_theme_v2'?new Promise(r=>{load=r;}):Promise.resolve(null),setItem:async(k,v)=>{stored.push(JSON.parse(v));}};
const native={getSystemColors:()=>null};
const stub={'react':React,'react/jsx-runtime':local('react/jsx-runtime'),'react-native':{useColorScheme:()=>scheme,AppState:{addEventListener:(_,cb)=>{foreground=cb;return{remove(){}};}}},'expo':{requireOptionalNativeModule:()=>native},'expo-font':{useFonts:()=>[true,null]},'@/services/storage':{storage},'./palettes':local('./src/theme/palettes.ts'),'./organic-palettes':local('./src/theme/organic-palettes.ts')};
const m=new Module(file,module);m.filename=file;m.require=n=>{if(n in stub)return stub[n];if(n.endsWith('.ttf'))return 1;throw Error(n);};m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {ThemeProvider,useTheme,useThemeControls}=m.exports;
function Consumer(){lastTheme=useTheme();controls=useThemeControls();const[draft,setDraft]=React.useState('125');React.useEffect(()=>{mounts++;return()=>{unmounts++;};},[]);return React.createElement('draft',{value:draft,onChange:setDraft});}
test('late hydration and repeated theme changes preserve live children/drafts and serialize the final preference',async()=>{
 let view;await renderer.act(async()=>{view=renderer.create(React.createElement(ThemeProvider,null,React.createElement(Consumer)));});
 await renderer.act(async()=>{view.root.findByType('draft').props.onChange('250');controls.setPreference({appearance:'light',colorSource:'lagoon'});controls.setPreference({appearance:'dark',colorSource:'peach'});});
 await renderer.act(async()=>{load('{"appearance":"light","colorSource":"forest"}');await Promise.resolve();});
 assert.deepEqual(controls.preference,{appearance:'dark',colorSource:'peach'});assert.equal(lastTheme.scheme,'dark');assert.equal(view.root.findByType('draft').props.value,'250');assert.equal(mounts,1);assert.equal(unmounts,0);assert.deepEqual(stored.at(-1),controls.preference);
 await renderer.act(async()=>{controls.setPreference({appearance:'system',colorSource:'system'});scheme='light';view.update(React.createElement(ThemeProvider,null,React.createElement(Consumer)));foreground('active');});
 assert.equal(lastTheme.scheme,'light');assert.equal(view.root.findByType('draft').props.value,'250');assert.equal(mounts,1);
 await renderer.act(async()=>view.unmount());assert.equal(unmounts,1);
});
