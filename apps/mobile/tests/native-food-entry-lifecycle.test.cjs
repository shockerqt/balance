const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');const assert=require('node:assert/strict');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const local=Module.createRequire(path.join(root,'package.json'));const ts=local('typescript');const React=local('react');const renderer=local('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
// Execute the real screen with controlled native/router/store dependencies.
const filename=path.join(root,'src/components/meal/native/native-food-entry-screen.tsx');
let nonce=0,focusCallback,focusCleanup,backs=0,calls=0,selected=[];let save=()=>Promise.resolve();
const router={back(){backs++;}};const navigation={dispatch(){backs++;}};const colors={background:'#12160f'};
const stub={
 'react':React,'react/jsx-runtime':local('react/jsx-runtime'),
 'expo-router':{useRouter:()=>router,useNavigation:()=>navigation,useLocalSearchParams:()=>({dateId:'2026-10-18',time:'08:15'}),useFocusEffect(cb){React.useEffect(()=>{focusCallback=cb;focusCleanup=cb();return()=>focusCleanup?.();},[cb]);}},
 'expo-router/react-navigation':{usePreventRemove(){}},
 'expo-crypto':{randomUUID:()=>`id-${++nonce}`},
 '../../../../modules/balance-daily-log/src/BalanceFoodEntryView':{BalanceFoodEntryView:p=>React.createElement('native-entry',p)},
 '@/components/ui':{Screen:p=>React.createElement(React.Fragment,null,p.children)},
 '@/hooks/use-auth':{useAuth:()=>({user:{id:'account-a'},isGuest:false})},
 '@/hooks/use-meal-store':{useMealStore:()=>({registerMealLog:doc=>{calls++;return save(doc);}})},
 '@/hooks/use-food-library-store':{useFoodLibraryStore:()=>({templateDocuments:[],isLibraryReady:true})},
 '@/theme':{useTheme:()=>({colors})},
 '@/lib/dates':{chileDateParts:()=>({hour:8,minute:15}),todayId:()=> '2026-10-18'},
 '@/services/sync/types':{isDateId:v=>/^\d{4}-\d{2}-\d{2}$/.test(v)},
 '@/hooks/use-logs-date':{logsDateStore:{set:v=>selected.push(v)}},
 './food-entry-contract':{nutrientFields:[],acceptFoodEntryEvent:(e,s,n)=>e.session===s&&e.sequence>n,createFoodEntry:(input,templates,id)=>{if(input.fail)throw new Error('Invalid input');return{id,...input};}},
 './interface-contract':{interfaceColors:colors},
};
const m=new Module(filename,module);m.filename=filename;m.require=n=>{if(n in stub)return stub[n];throw new Error('Unexpected dependency '+n);};
m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const Screen=m.exports.default;
async function mount(){backs=0;calls=0;selected=[];let view;await renderer.act(async()=>{view=renderer.create(React.createElement(Screen));});return view;}
const props=v=>v.root.findByType('native-entry').props;
function event(v,sequence=1,input={date:'2026-10-18'}){const p=props(v);return p.onAction({nativeEvent:{session:JSON.parse(p.data).session,sequence,action:'save',input:JSON.stringify(input)}});}
async function unmount(v){await renderer.act(async()=>v.unmount());}
test('native save retry acknowledgements and completion survive focus changes', async()=>{
 save=()=>Promise.resolve();let v=await mount();
 await renderer.act(async()=>{await event(v,1,{fail:true});});const firstErrorStatus=props(v).status;
 await renderer.act(async()=>{await event(v,2,{fail:true});});assert.notEqual(props(v).status,firstErrorStatus,'every retry must acknowledge the native pending request, even when the error repeats');await unmount(v);
 v=await mount();await renderer.act(async()=>{await event(v);});assert.equal(backs,1,'immediate batched save must close the route');await unmount(v);
 let resolve;save=()=>new Promise(r=>resolve=r);v=await mount();const draft=JSON.parse(props(v).data).draftId;let pending;
 await renderer.act(async()=>{pending=event(v);await Promise.resolve();});await renderer.act(async()=>focusCleanup());await renderer.act(async()=>{resolve();await pending;});
 assert.equal(backs,0,'blurred save must not navigate another screen');assert.equal(JSON.parse(props(v).status).saving,false,'completed blurred save must unlock state');
 await renderer.act(async()=>{focusCleanup=focusCallback();});assert.equal(backs,1,'refocusing must finish the completed save');assert.equal(JSON.parse(props(v).data).draftId,draft);await unmount(v);
 save=()=>Promise.resolve();v=await mount();await renderer.act(async()=>{await event(v,3,{fail:true});});await renderer.act(async()=>focusCleanup());await renderer.act(async()=>{focusCleanup=focusCallback();});await renderer.act(async()=>{await event(v,1);});assert.equal(calls,1,'new focus must accept a restarted native sequence');assert.equal(backs,1);await unmount(v);
});
