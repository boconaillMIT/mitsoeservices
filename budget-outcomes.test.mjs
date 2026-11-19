import test from 'node:test';
import assert from 'node:assert/strict';
import {recentBudgetOutcomes} from './src/budget-hq.mjs';
test('two fixed prior years preserve missing records, explicit zero and initial declines',()=>{
 const row={unit_key:'example',year:2027,requested:100,school:null,provost:null,scc:null,unresolved:null,declined:100,declinedIsInitial:true};
 let [missing,current]=recentBudgetOutcomes([row],'example',2028);
 assert.equal(missing.year,2026);assert.equal(missing.outcome,'No record');assert.equal(missing.requested,null);
 assert.equal(current.outcome,'Outcome incomplete');assert.equal(current.declined,null);assert.equal(current.approved,null);
 current=recentBudgetOutcomes([{...row,school:0,declinedIsInitial:false}],'example',2028)[1];
 assert.equal(current.outcome,'Not funded');assert.equal(current.approved,0);assert.equal(current.school,0);
});
test('partial, full and incomplete funding remain distinct; all funders separate from Dean',()=>{
 const row={unit_key:'example',year:2027,requested:100,school:20,provost:30,scc:10,unresolved:5,declined:35,declinedIsInitial:false};
 let y=recentBudgetOutcomes([row],'example',2028)[1];assert.equal(y.approved,65);assert.equal(y.school,20);assert.equal(y.outcome,'Partially funded');
 y=recentBudgetOutcomes([{...row,declined:null}],'example',2028)[1];assert.equal(y.outcome,'Outcome incomplete');
 y=recentBudgetOutcomes([{...row,provost:65,declined:0}],'example',2028)[1];assert.equal(y.outcome,'Fully funded');
 y=recentBudgetOutcomes([row,{...row,requested:null}],'example',2028)[1];assert.equal(y.unpriced,1);assert.equal(y.outcome,'Outcome incomplete');
});
