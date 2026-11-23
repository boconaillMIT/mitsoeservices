import test from 'node:test';import assert from 'node:assert/strict';
import {alignBudgetRequests,renderBudgetHistory,comparisonRequests,requestBreakdownHtml} from './public/budget-history.mjs';
const row=(description,requested=100)=>({description,requested,approved:requested,school:requested});
test('aligns clear recurring asks across spelling, quantity and case changes while retaining original lines',()=>{
 const years=[{year:2026,requests:[row('12 TAs'),row('Equipment for Teaching Labs')]},{year:2027,requests:[row('14 TAs'),row('Equipment for teaching labs')]},{year:2028,current:true,requests:[row('15 GIB-supported TAs (up from prior yrs)'),row('Equipment for Teaching Labs')]}];
 const groups=alignBudgetRequests(years);assert.equal(groups.length,2);const ta=groups.find(g=>g.key==='teaching-assistants');assert.deepEqual(Object.values(ta.cells).map(a=>a.length),[1,1,1]);assert.equal(ta.cells[2026][0].description,'12 TAs');
 const html=renderBudgetHistory(years);assert.match(html,/<table class="bh-ask-table">/);assert.match(html,/data-year="FY28 · Current"/);assert.match(html,/15 GIB-supported TAs/);
});
test('never collapses multiple same-year asks or confuses distinct courses and staff bundles',()=>{
 const years=[{year:2026,requests:[row('3 TAs'),row('7 TAs'),row('M&S for 1.001'),row('M&S for 1.002'),row('Financial Officer')]},{year:2027,requests:[row('4 TAs'),row('9 TAs'),row('SRA / FO')]},{year:2028,current:true,requests:[row('Critical staff positions (SRA/ HR/ SrTech)')]}];
 const groups=alignBudgetRequests(years,'meche');assert.equal(groups.find(g=>g.key==='teaching-assistants').cells[2026].length,2);assert.equal(groups.filter(g=>g.label.startsWith('M&S')).length,2);assert.deepEqual(Object.values(groups.find(g=>g.key==='finance-research-admin').cells).map(a=>a.length),[1,1,0]);assert.equal(groups.reduce((a,g)=>a+Object.values(g.cells).reduce((a,r)=>a+r.length,0),0),9);
});
test('keeps unknown entries separate, preserves missing years, escapes labels and shows comparable amount changes',()=>{
 const years=[{year:2026,requests:[row(''),row('Equipment <test>',100)]},{year:2027,requests:[row(''),row('Equipment <test>',125)]},{year:2028,current:true,requests:[]}];
 const groups=alignBudgetRequests(years);assert.equal(groups.filter(g=>g.key.startsWith('unknown|')).length,2);const html=renderBudgetHistory(years);assert.match(html,/Equipment &lt;test&gt;/);assert.doesNotMatch(html,/<test>/);assert.match(html,/Ask \+\$25 vs FY26/);assert.match(html,/No matching request recorded/);
});

const bundle=()=>({record_id:'123',description:'Critical staff positions',requested:600,decision:'pending',request_funding:{dean:600,provost:null,scc:0},source:{request_breakdown:{schema:1,unit:'meche',year:2028,date:'2026-11-22',document:'Fictional memo',items:[{description:'Senior research administrator (1.0 FTE)',amount:300},{description:'HR administrator (0.5 FTE)',amount:200},{description:'Senior technical instructor (0.5 FTE)',amount:100}]}}});
test('staff components align with historical HR and finance asks and preserve the bundle total',()=>{
 const years=[{year:2026,requests:[row('Financial Officer'),row('HR admin'),row('HR Representative')]},{year:2027,requests:[row('SRA / FO')]},{year:2028,current:true,requested:600,requests:[bundle()]}];
 const html=renderBudgetHistory(years,{unitKey:'meche'});assert.match(html,/Senior technical instructor/);assert.match(html,/Asked \$300/);assert.match(html,/Asked \$200/);assert.match(html,/recommendation applies to the combined request/);
 const expanded=comparisonRequests(bundle(),'meche',2028),groups=alignBudgetRequests([...years.slice(0,2),{...years[2],requests:expanded}],'meche');assert.equal(groups.length,3);assert.deepEqual(Object.values(groups.find(g=>g.key==='hr-administrator').cells).map(rs=>rs.length),[2,0,1]);assert.deepEqual(Object.values(groups.find(g=>g.key==='finance-research-admin').cells).map(rs=>rs.length),[1,1,1]);assert.equal(expanded.reduce((n,r)=>n+r.requested,0),600);assert.equal(expanded.reduce((n,r)=>n+r.request_funding.dean,0),600);assert.equal(expanded[0].request_funding.provost,null);assert.match(requestBreakdownHtml(bundle(),'meche',2028),/HR administrator/);
});
test('bundle recommendations reconcile exactly and invalid or wrong-scope breakdowns stay intact',()=>{
 const b={...bundle(),decision:'support',supported:301,soe:151,provost:150};const items=comparisonRequests(b,'meche',2028);for(const k of ['supported','soe','provost'])assert.equal(items.reduce((n,r)=>n+r[k],0),b[k]);assert(items.every(r=>r.decision==='support'));
 assert.deepEqual(comparisonRequests(b,'be',2028),[b]);assert.deepEqual(comparisonRequests(b,'meche',2027),[b]);const invalid=bundle();invalid.source.request_breakdown.items[0].amount=1;assert.deepEqual(comparisonRequests(invalid,'meche',2028),[invalid]);
});
