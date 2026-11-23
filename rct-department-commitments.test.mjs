import test from 'node:test';import assert from 'node:assert/strict';import {emptyReview} from './public/rct-model.mjs';import {departmentCommitmentView,renderDepartmentCommitments} from './public/rct-department-commitments.mjs';
const row=(id,department,review={})=>({id,source:{pi:id,title:'Example proposal',department},review:{...emptyReview(),...review}});
test('department commitments distinguish entered money, blanks, zero and partial department coverage',()=>{
 const records=[row('A','Example department',{department:30}),row('B','Example department'),row('C','Other example',{department:0}),row('D','Third example',{department:20})],view=departmentCommitmentView(records);
 assert.equal(view.amount,50);assert.equal(view.funded,2);assert.equal(view.needs,1);assert.equal(view.zero,1);assert.equal(view.departments.find(g=>g.label==='Example department').status,'partial');assert.equal(view.departments.find(g=>g.label==='Other example').status,'zero');
 assert.equal(departmentCommitmentView(records,{filter:'needs'}).rows.length,1);assert.equal(departmentCommitmentView(records,{filter:'funded'}).rows.length,2);assert.equal(departmentCommitmentView(records,{filter:'zero'}).rows.length,1);
 assert.throws(()=>departmentCommitmentView(records,{filter:'invalid'}));
});
test('named department contributors count in any local slot while generic PI and School amounts do not count',()=>{
 const record=row('Example','Mechanical Engineering',{department:10,pi:5,other:7,school:100,provost:100,evpt:100,fundingLabels:{department:'Department',pi:'PI',other:'IMES'}}),view=departmentCommitmentView([record]);
 assert.equal(view.amount,17);assert.equal(view.departments.find(g=>g.key==='meche').amount,10);assert.equal(view.departments.find(g=>g.key==='imes').amount,7);assert.equal(view.departments.length,2);
 const blank=departmentCommitmentView([row('Example','Nuclear Engineering',{department:10,fundingLabels:{department:'NSE',pi:'DMSE',other:'Other'}})]);assert.equal(blank.departments.find(g=>g.key==='dmse').status,'missing');assert.equal(blank.needs,1);
});
test('joint affiliations and joint funding are visible without double-counting or inventing department splits',()=>{
 const r=row('Joint','Civil and Environmental Engineering and Architecture',{department:30}),view=departmentCommitmentView([r]);assert.equal(view.departments.length,2);assert.equal(view.amount,30);assert.equal(view.shared,true);assert(view.departments.every(g=>g.amount===null&&g.status==='joint'));
 const split=departmentCommitmentView([{...r,review:{...r.review,department:10,pi:20,fundingLabels:{department:'CEE',pi:'Architecture',other:'Other'}}}]);assert.equal(split.amount,30);assert.equal(split.departments.find(g=>g.key==='cee').amount,10);assert.equal(split.departments.find(g=>g.key==='architecture').amount,20);assert.equal(split.needs,0);
 const zero=departmentCommitmentView([row('Joint','Civil Engineering and Architecture',{department:0})]);assert(zero.departments.every(g=>g.amount===0&&g.status==='zero'));
});
test('HQ-declined proposals are optional and rendering preserves source data and escapes content',()=>{
 const records=[row('Example <PI>','Example department',{department:10}),row('Declined','Other example',{decision:'Decline',department:20})],before=JSON.stringify(records),view=departmentCommitmentView(records);
 assert.equal(view.excluded,1);assert.equal(view.amount,10);assert.equal(departmentCommitmentView(records,{includeDeclined:true}).amount,30);const html=renderDepartmentCommitments(view);assert.match(html,/Example &lt;PI&gt;/);assert.doesNotMatch(html,/<PI>/);assert.equal(JSON.stringify(records),before);
});
