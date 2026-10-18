import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodEntry, decimal, acceptFoodEntryEvent, nutrientFields } from '../src/components/meal/native/food-entry-contract.ts';
import { isMealLogDoc } from '../src/services/sync/types.ts';
import { chileDateParts } from '../src/lib/dates.ts';
const template = { id: '9e2d08f7-cb78-4e09-84d0-753040147b27', name: 'Avena', isOfficial: false, updatedAt: 10, _deleted: false, details: { schemaVersion: 2, canonicalUnit: 'g', nutritionPer100: { calories: 380, protein: 13, carbs: 64, fat: 7, fiber: null, sodiumMg: 3.27, extendedNutrition: { calciumMg: 34.21, leucineG: 1.23 } }, portions: [{ id: 'cup', name: 'taza', portionQuantity: 1, canonicalQuantity: 80 }] } };
const input = { date: '2026-10-18', time: '08:15', quantity: '1,5', templateId: template.id, templateRevision: 10, portionId: 'cup' };
const manual = { date: input.date, time: input.time, quantity: '180', templateId: '', unit: 'ml', name: ' Café ', nutrients: { calories: '2', protein: '0', carbs: '0', fat: '0', fiber: '', sodiumMg: '0', caffeineMg: '40,5' } };
test('named portion keeps exact historical nutrition, conversion and Chilean time', () => {
 const doc = createFoodEntry(input, [template], 'id', 123);
 assert.equal(isMealLogDoc(doc), true); assert.equal(doc.canonicalQuantity,120);
 assert.deepEqual(doc.entry,{enteredQuantity:1.5,portionSnapshot:{portionId:'cup',name:'taza',portionQuantity:1,canonicalQuantity:80}});
 assert.deepEqual(doc.nutritionSnapshot.nutritionPer100, template.details.nutritionPer100);
 assert.notEqual(doc.nutritionSnapshot.nutritionPer100, template.details.nutritionPer100);
 assert.deepEqual(chileDateParts(doc.consumedAt), {year:2026,month:10,day:18,hour:8,minute:15});
});
test('manual snapshots omit unknowns, retain explicit zero and accept extended backend nutrients',()=>{
 const doc=createFoodEntry(manual,[],'id',123);
 assert.equal(doc.templateId,null);assert.equal(doc.nameSnapshot,'Café');assert.equal(doc.nutritionSnapshot.canonicalUnit,'ml');
 assert.deepEqual(doc.nutritionSnapshot.nutritionPer100,{calories:2,protein:0,carbs:0,fat:0,sodiumMg:0,extendedNutrition:{caffeineMg:40.5}});
 assert.deepEqual(doc.entry,{enteredQuantity:180});
});
test('rejects deleted/stale templates, foreign portions, non-finite and missing nutrition',()=>{
 for(const p of [{...input,templateRevision:9},{...input,portionId:'removed'},{...input,quantity:'0'},{...input,quantity:'Infinity'},{...input,date:'2026-02-30'},{...input,time:'24:00'},{...manual,nutrients:{...manual.nutrients,protein:''}},{...manual,nutrients:{...manual.nutrients,fat:'-1'}},{...manual,nutrients:{...manual.nutrients,surprise:'1'}},{...manual,name:'a'.repeat(161)},{...manual,unit:'oz'}])assert.throws(()=>createFoodEntry(p,[template],'id'));
 assert.throws(()=>createFoodEntry(input,[{...template,_deleted:true}],'id'));
 assert.throws(()=>createFoodEntry(input,[],'id'));
});
test('arithmetic overflow and nonexistent Chilean DST times fail before persistence',()=>{
 assert.throws(()=>createFoodEntry({...input,quantity:'1'+'0'.repeat(308)},[template],'id'));
 assert.throws(()=>createFoodEntry({...manual,date:'2026-09-06',time:'00:30'},[],'id'));
 assert.equal(decimal('NaN'),null);assert.equal(decimal(' 0,125 '),0.125);assert.equal(decimal('0',true),null);
});
test('late account callbacks, replayed saves and unknown actions cannot cross the bridge',()=>{
 const event={session:'s',sequence:3,action:'save'};
 assert.equal(acceptFoodEntryEvent(event,'s',2),true);
 for(const e of [{...event,session:'old'},{...event,sequence:2},{...event,sequence:NaN},{...event,action:'replace'}])assert.equal(acceptFoodEntryEvent(e,'s',2),false);
});
test('all backend extended nutrients have explicit display metadata',()=>{
 assert.equal(new Set(nutrientFields.map(f=>f.key)).size,nutrientFields.length);
 assert.ok(nutrientFields.every(f=>f.label&&f.unit));
});
