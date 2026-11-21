import test from 'node:test';import assert from 'node:assert/strict';
import {alignBudgetRequests,renderBudgetHistory} from './public/budget-history.mjs';
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
 const years=[{year:2026,requests:[row('TBA'),row('Equipment <test>',100)]},{year:2027,requests:[row('TBA'),row('Equipment <test>',125)]},{year:2028,current:true,requests:[]}];
 const groups=alignBudgetRequests(years);assert.equal(groups.filter(g=>g.key.startsWith('unknown|')).length,2);const html=renderBudgetHistory(years);assert.match(html,/Equipment &lt;test&gt;/);assert.doesNotMatch(html,/<test>/);assert.match(html,/Ask \+\$25 vs FY26/);assert.match(html,/No matching request recorded/);
});
