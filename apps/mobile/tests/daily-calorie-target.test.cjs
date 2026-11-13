const path = require('node:path'), fs = require('node:fs'), Module = require('node:module');
const test = require('node:test'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), local = Module.createRequire(path.join(root, 'package.json'));
const React = local('react'), renderer = local('react-test-renderer'), ts = local('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
const host = name => props => React.createElement(name, props, props.children);
const targets = local('./src/lib/day-targets.ts'), types = local('./src/services/sync/types.ts');
function load(relative, stubs) {
  const file = path.join(root, relative), m = new Module(file, module); m.filename = file;
  m.require = n => { if (n in stubs) return stubs[n]; throw Error('Unexpected ' + n); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports;
}
test('target validation, legacy fallback and empty-day projection use safe calories', () => {
  for (const v of [undefined,null,'2500',499,10001,2000.5,NaN,Infinity]) assert.equal(targets.resolveDailyCalorieTarget(v),2200);
  for (const v of [500,2500,10000]) assert.equal(targets.resolveDailyCalorieTarget(v),v);
  const doc={ id:'guest',preferences:{weightTrackingEnabled:false},updatedAt:1,_deleted:false };
  assert.equal(types.isUserPreferencesDoc(doc),true);
  assert.equal(types.isUserPreferencesDoc({...doc,preferences:{dailyCalorieTarget:2500}}),true);
  assert.equal(types.isUserPreferencesDoc({...doc,preferences:{dailyCalorieTarget:-1}}),false);
  const {emptyDayLog}=local('./src/lib/meal-day-projection.ts');
  assert.equal(emptyDayLog('2026-11-12').targetCalories,2200);
  assert.equal(emptyDayLog('2026-11-12',2500).targetCalories,2500);
});
async function harness(populated, initialDoc) {
  let cache=JSON.stringify([initialDoc ?? {id:'guest',preferences:{weightTrackingEnabled:false},updatedAt:1,_deleted:false}]), handlers;
  const pushes=[]; let prefsValue;
  const preferences=load('src/hooks/use-preferences-store.tsx',{
    react:React,'react/jsx-runtime':local('react/jsx-runtime'),'@/lib/day-targets':targets,
    '@/services/config':{API_BASE_URL:'https://example.test/api'},'@/services/auth/session-state':{authDataNamespace:()=> 'guest'},
    '@/hooks/use-auth':{useAuth:()=>({user:null})},'@/services/sync/types':types,
    '@/services/storage':{storage:{getItem:async()=>cache,setItem:async(_key,v)=>{cache=v;},isDurableItem:()=>true}},
    '@/services/sync/sync-client':{collectionStorageKey:()=> 'prefs',syncClient:{
      invalidateCollectionCheckpoint:async()=>{},reportLocalPersistenceError(){},setCollectionEnabled(){},
      registerCollection:(_name,cb)=>{handlers=cb;return()=>{};},enqueue:async(...args)=>{pushes.push(args);},
    }},
  });
  const today=local('./src/lib/dates.ts').todayId();
  const food={id:'a',name:'Avena',portion:'100 g',calories:100,protein:5,carbs:10,fat:2};
  const day={dateId:today,displayDate:today,...targets.DEFAULT_TARGETS,foods:populated?[food]:[]};
  const dayLogs=populated?{[today]:day}:{};
  const nav={get:()=>today,getRevision:()=>0,set(){},shift(){},subscribe:()=>()=>{}};
  const ui=Object.fromEntries(['Button','Icon','Input','Screen','Text','Card','ProgressBar'].map(n=>[n,host(n)]));
  const native=Object.fromEntries(['View','ScrollView','Switch','TouchableOpacity','Modal','Pressable'].map(n=>[n,host(n)]));native.StyleSheet={create:x=>x};native.Alert={alert(){}};
  const clear=()=>{}, selection={clear,selectedIds:new Set(),isSelectionMode:false};
  const stubs={
    react:React,'react/jsx-runtime':local('react/jsx-runtime'),'react-native':native,
    'expo-router':{Stack:{Screen:host('Stack')},useRouter:()=>({push(){}}),useFocusEffect:fn=>React.useEffect(fn,[fn])},
    'expo-router/react-navigation':{useIsFocused:()=>true},
    'react-native-reanimated':{__esModule:true,default:{View:host('AnimatedView')},useSharedValue:v=>React.useRef({value:v}).current,useAnimatedStyle:fn=>fn(),useAnimatedReaction(){},runOnJS:fn=>fn},
    '@/components/ui':ui,'@/hooks/use-preferences-store':preferences,
    '@/hooks/use-auth':{useAuth:()=>({isGuest:true})},
    '@/hooks/use-meal-store':{useMealDay:()=>day,useMealActions:()=>({}),useMealStore:()=>({dayLogs,mealDocuments:[]}),emptyDayLog:local('./src/lib/meal-day-projection.ts').emptyDayLog,sumDay:local('./src/lib/nutrition.ts').sumNutrition},
    '@/hooks/use-weight-store':{useWeightStore:()=>({weightsByDate:{}})},'@/hooks/use-food-selection':{useFoodSelection:()=>selection},
    '@/hooks/use-logs-date':{logsDateStore:nav,useLogsSelectedDate:()=>[today,()=>{}],useLogsDateRevision:()=>0},
    '@/components/weight/daily-weight-row':{DailyWeightRow:host('WeightRow')},
    '@/lib/dates':local('./src/lib/dates.ts'),'@/lib/nutrition':local('./src/lib/nutrition.ts'),'@/lib/day-targets':targets,
    '@/lib/summary-buckets':local('./src/lib/summary-buckets.ts'),
    '@/dev/react-native-spike-gate':{reactNativeSpikeEnabled:false},
    '@/theme':{font:{},makeStyles:()=>()=>({}),useTheme:()=>({colors:{},space:{},type:{},radius:{},border:{}}),useThemeControls:()=>({preference:{appearance:'system'},ready:true})},
    '@/components/updates/update-information':{UpdateInformation:host('Updates')},
    '@/components/summary/macro-grid':{MacroGrid:host('Macros')},'@/components/summary/weekly-chart':{WeeklyChart:host('Weekly')},'@/components/weight/weight-trend-card':{WeightTrendCard:host('Weight')},
    './native/interface-contract':{createInterfaceDaysProjector:()=>()=>({})},
    './date-strip-header':{DateStripHeader:host('DateHeader')},'./sticky-macro-header':{StickyMacroHeader:host('DiaryCalories')},
    './native-day-window':{NativeDayWindow:props=>props.renderDay(props.dateId)},'./meal-group-feed':{MealGroupFeed:host('Feed')},
  };
  const Settings=load('src/app/settings.tsx',stubs).default;
  const Diary=load('src/components/meal/react-native-diary.tsx',stubs).ReactNativeDiary;
  const Summary=load('src/components/meal/react-native-summary.tsx',stubs).ReactNativeSummary;
  const Main=load('src/app/(tabs)/index.tsx',stubs).default;
  function Probe(){prefsValue=preferences.usePreferencesStore();return null;}
  const Content=()=>React.createElement(React.Fragment,null,React.createElement(Probe),React.createElement(Settings),React.createElement(Diary),React.createElement(Summary,{onOpen(){}}),React.createElement(Main));
  let tree;
  const mount=async()=>{await renderer.act(async()=>{tree=renderer.create(React.createElement(preferences.PreferencesProvider,null,React.createElement(Content)));});};
  await mount();
  return {tree,day,pushes,prefs:()=>prefsValue,cache:()=>JSON.parse(cache)[0],
    input:()=>tree.root.findAllByType('Input').find(n=>n.props.accessibilityLabel==='Meta diaria de calorías'),
    async change(value){await renderer.act(async()=>this.input().props.onChangeText(value));},
    async save(){await renderer.act(async()=>tree.root.findAllByType('Button').find(n=>n.props.title==='Guardar meta').props.onPress());},
    async remote(value){await renderer.act(async()=>handlers.onDocuments([{id:'guest',preferences:{dailyCalorieTarget:value},updatedAt:Date.now()+1000,_deleted:false}]));},
    async close(){await renderer.act(async()=>tree.unmount());},
  };
}
for(const populated of [false,true]) test(`actual Settings persists and propagates target to diary/summary/main (${populated?'populated':'empty'})`,async()=>{
  const h=await harness(populated);try{
    assert.equal(h.input().props.value,'2200');assert.equal(h.prefs().dailyCalorieTarget,2200);
    await h.change('2500');await h.save();
    assert.equal(h.cache().preferences.dailyCalorieTarget,2500);assert.equal(h.cache().preferences.weightTrackingEnabled,false);
    assert.equal(h.pushes.at(-1)[0],'userPreferences');assert.equal(h.pushes.at(-1)[1].preferences.dailyCalorieTarget,2500);
    assert.ok(h.tree.root.findAllByType('DiaryCalories').every(n=>n.props.targetCalories===2500));
    assert.ok(h.tree.root.findAllByType('Text').some(n=>[n.props.children].flat().join('').includes('meta 2.500')));
    assert.ok(h.tree.root.findAllByType('ProgressBar').some(n=>n.props.value===(populated?100/2500:0)));
    assert.equal(h.day.targetCalories,2200,'canonical meal snapshot is unchanged');
    await h.remote(1800);assert.equal(h.prefs().dailyCalorieTarget,1800);assert.equal(h.input().props.value,'1800');
    assert.ok(h.tree.root.findAllByType('DiaryCalories').every(n=>n.props.targetCalories===1800));
    await h.change('499');await h.save();assert.equal(h.prefs().dailyCalorieTarget,1800);
    assert.ok(h.tree.root.findAllByType('Text').some(n=>n.props.accessibilityRole==='alert'));
  }finally{await h.close();}
});

test('saved target rehydrates through canonical preferences storage',async()=>{
  const first=await harness(false);let saved;
  try{await first.change('2600');await first.save();saved=first.cache();}finally{await first.close();}
  const second=await harness(false,saved);try{
    assert.equal(second.prefs().dailyCalorieTarget,2600);assert.equal(second.input().props.value,'2600');
  }finally{await second.close();}
});
