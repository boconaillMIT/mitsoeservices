import test from 'node:test';import assert from 'node:assert/strict';
import {recentBudgetOutcomes} from './src/budget-hq.mjs';import {renderBudgetHistory,historicalStatus} from './public/budget-history.mjs';
test('three years retain each funder, initial declines, final declines and missing values',()=>{
 const base={unit_key:'example',year:2025,requested:100,school:20,provost:30,scc:5,unresolved:10,declined:35,declinedIsInitial:true,original:'Example <lab>',record_id:'1'};
 const ys=recentBudgetOutcomes([base,{...base,unit_key:'other',school:9999}],'example',2028);
 assert.deepEqual(ys.map(y=>y.year),[2025,2026,2027]);assert.equal(ys[0].approved,65);assert.equal(ys[0].provost,30);assert.equal(ys[0].scc,5);assert.equal(ys[0].unresolved,10);assert.equal(ys[0].declined,null);assert.equal(ys[0].initial_declined,35);assert.equal(ys[0].requests[0].school,20);assert.equal(ys[1].requested,null);
 const html=renderBudgetHistory(ys);assert.match(html,/Previous three years/);assert.match(html,/Example &lt;lab&gt;/);assert.match(html,/Provost \$30/);assert.match(html,/Initial decline \$35/);assert.match(html,/No request or funding outcome recorded/);assert.doesNotMatch(html,/9999|9,999/);
 const final=recentBudgetOutcomes([{...base,declinedIsInitial:false}],'example',2028)[0];assert.equal(final.declined,35);assert.equal(final.initial_declined,null);
});
test('scorecards distinguish funded, partial, final rejection, removal and initial decline',()=>{
 const r={requested:100,approved:null,declined:null,initial_declined:null};
 assert.equal(historicalStatus({...r,approved:100}).label,'Funded');assert.equal(historicalStatus({...r,approved:50}).label,'Part funded');assert.equal(historicalStatus({...r,declined:100,status:'Rejected'}).label,'Rejected');assert.equal(historicalStatus({...r,initial_declined:100}).label,'Declined · initial');assert.equal(historicalStatus({...r,status:'Removed'}).label,'Removed');assert.match(historicalStatus({...r,status:'Approved (initial)'}).label,/amount unknown/);
});
