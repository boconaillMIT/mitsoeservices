import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapRecord,totals,groupForUnit} from './public/budget-model.mjs';
import {createBudgetHandler} from './src/budget-explorer.mjs';

test('budget comparisons preserve blanks, initial decisions and unattributed funding',()=>{
 const row=mapRecord({'Budget Fiscal Year':'2019',Department:'CEE','Original Request Description':'Faculty support','Historical allocation - funder unresolved':123,'Declined':50,'Provost Non-recurring (non-base) - SoE':999});
 assert.equal(row.year,2019);assert.equal(row.requested,null);assert.equal(row.provost,null);assert.equal(row.school,null);assert.equal(row.unresolved,123);assert.equal(row.declined,50);assert.equal(row.declinedIsInitial,true);
 const approved=mapRecord({'Budget Fiscal Year':'2026',Department:'CEE','Recurring (base) - DLC':0,'Non-recurring (non-base) - DLC':100,'Provost Non-recurring (non-base) - Approved':25,'SoE Non-recurring (non-base) - SoE_Approved':0,'Declined Final':75});
 assert.equal(approved.requested,100);assert.equal(approved.provost,25);assert.equal(approved.school,0);assert.equal(approved.declinedIsInitial,false);
 assert.deepEqual(totals([row,approved]).requested,{amount:100,recorded:1,total:2});assert.equal(groupForUnit('IDSS / TPP'),'Combined or unclassified');assert.equal(groupForUnit('Aero-Astro'),'Academic units');
});
test('budget source denies unauthorized users before requesting metadata',async()=>{
 let touched=false;const handler=createBudgetHandler({authorize:async()=>({statusCode:403}),fields:async()=>{touched=true;}});assert.equal((await handler({httpMethod:'GET'})).statusCode,403);assert.equal(touched,false);
});
test('recurring and one-time Provost support are kept separately',()=>{
 const r=mapRecord({'Budget Fiscal Year':'2024',Department:'EECS','Provost Recurring (base) - Approved':40,'Provost Non-recurring (non-base) - Approved':60});
 assert.equal(r.provost,100);assert.equal(r.provostBase,40);assert.equal(r.provostNon,60);
 const blank=mapRecord({'Budget Fiscal Year':'2024',Department:'EECS'});assert.equal(blank.provostBase,null);assert.equal(blank.provostNon,null);
 const t=totals([r,blank]);assert.deepEqual(t.provostBase,{amount:40,recorded:1,total:2});assert.deepEqual(t.provostNon,{amount:60,recorded:1,total:2});
});
