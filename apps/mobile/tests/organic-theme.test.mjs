import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOrganicTheme } from '../src/theme/palettes.ts';
import { organicPalettes, parseThemePreferences } from '../src/theme/organic-palettes.ts';
function rgb(hex) { return hex.slice(1).match(/../g).map(x => parseInt(x,16)); }
function luminance(c) { const n=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}); return n[0]*.2126+n[1]*.7152+n[2]*.0722; }
function contrast(a,b) { const x=luminance(typeof a==='string'?rgb(a):a),y=luminance(typeof b==='string'?rgb(b):b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
test('all accepted schemes preserve readable solid roles and every gradient interpolation',()=>{
 for(const source of Object.keys(organicPalettes))for(const mode of ['light','dark']){
  const t=makeOrganicTheme(source,mode),c=t.colors;
  for(const [ink,bg]of [[c.text,c.background],[c.textSecondary,c.surface],[c.textSecondary,c.surfaceRaised],[c.onPrimary,c.primary],[c.onSecondary,c.secondary]])assert(contrast(ink,bg)>=4.5,`${source}/${mode}: ${ink} on ${bg}`);
  for(const [name,ink]of [['header',c.textSecondary],['action',c.onPrimary]]){
   const stops=t.gradients[name].map(rgb);for(let i=1;i<stops.length;i++)for(let n=0;n<=100;n++)assert(contrast(ink,stops[i-1].map((v,k)=>v+(stops[i][k]-v)*n/100))>=4.5,`${source}/${mode}/${name}`);
  }
 }
});
test('device preference migration preserves explicit appearance and rejects malformed choices',()=>{
 assert.deepEqual(parseThemePreferences(null),{appearance:'system',colorSource:'system'});
 assert.deepEqual(parseThemePreferences(null,'libro'),{appearance:'light',colorSource:'forest'});
 assert.deepEqual(parseThemePreferences(null,'libroNoche'),{appearance:'dark',colorSource:'forest'});
 assert.deepEqual(parseThemePreferences('{"appearance":"light","colorSource":"lagoon"}','libroNoche'),{appearance:'light',colorSource:'lagoon'});
 for(const bad of ['broken','null','{}','{"appearance":"auto","colorSource":"forest"}','{"appearance":"dark","colorSource":"constructor"}'])assert.deepEqual(parseThemePreferences(bad),{appearance:'system',colorSource:'system'});
});
test('System uses Bosque without native support and accepts one shared native role set',()=>{
 assert.deepEqual(makeOrganicTheme('system','light').colors,makeOrganicTheme('forest','light').colors);
 const roles=makeOrganicTheme('lagoon','dark').colors;const dynamic=makeOrganicTheme('system','dark',roles);
 assert.equal(dynamic.colors.background,roles.background);assert.equal(dynamic.colors.onPrimary,roles.onPrimary);
 for(const stop of dynamic.gradients.action)assert(contrast(dynamic.colors.onPrimary,stop)>=4.5);
 assert.equal(makeOrganicTheme('forest','dark',roles).colors.background,organicPalettes.forest.dark.roles.background);
});
