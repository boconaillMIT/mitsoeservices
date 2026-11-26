import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cleanRequest,applyAction,visibleRecord,submissionErrors,money,soePercent} from './public/dr-model.mjs';
const now=()=> '2026-11-26T15:00:00.000Z',owner={kerberos:'studentx',canWrite:false},first={kerberos:'reviewera',canWrite:true},second={kerberos:'reviewerb',canWrite:true};
export function fixture(overrides={}){return {id:randomUUID(),revision:randomUUID(),owner:'studentx',createdBy:'studentx',organizationId:randomUUID(),departmentSource:'directory',status:'submitted',request:cleanRequest({requesterName:'Test Student',requesterEmail:'studentx@mit.edu',department:'Test department',organization:'Fictional Robotics Club',organizationType:'Student team',teamRole:'Treasurer',title:'Fictional workshop',purpose:'Run a fictional workshop.',beneficiaries:'Test students',soeConnection:'Engineering education',fundUse:'Materials',activityStart:'2027-06-01',activityEnd:'2027-06-02',deadline:'2027-05-01',members:8,soeMembers:4,requested:1000,goal:50000,secured:0,budget:[{description:'Materials',amount:1000}],correspondence:'Internal email text'}),validity:null,finance:null,files:[],history:[],createdAt:now(),updatedAt:now(),...overrides};}
const apply=(record,command,actor=first)=>applyAction(record,command,actor,{uuid:randomUUID,now});
test('validity approval needs no cost object, financial approval needs a different person',()=>{
 const valid=apply(fixture(),{action:'validity',validity:{by:'spoof'}});assert.equal(valid.status,'finance');assert.equal(valid.validity.by,'reviewera');assert.equal(valid.finance,null);
 assert.throws(()=>apply(valid,{action:'finance',amount:1000,costObject:'TEST-CO',message:'Approved'},first),e=>e.status===403&&/different person/.test(e.message));
 const approved=apply(valid,{action:'finance',amount:1000,costObject:'TEST-CO',message:'Approved'},second);assert.equal(approved.status,'approved');assert.equal(approved.finance.by,'reviewerb');assert.equal(approved.finance.costObject,'TEST-CO');
});
test('financial approval requires validity, positive amount, cost object and decision message',()=>{
 const record=fixture();assert.throws(()=>apply(record,{action:'finance',amount:1000,costObject:'TEST'},second),/Validity approval/);
 const valid=apply(record,{action:'validity'});
 for(const command of [{amount:0,costObject:'TEST',message:'Decision'},{amount:1001,costObject:'TEST',message:'Decision'},{amount:1000,costObject:'',message:'Decision'},{amount:1000,costObject:'TEST',message:''}])assert.throws(()=>apply(valid,{action:'finance',...command},second));
 const partial=apply(valid,{action:'finance',amount:500,costObject:'TEST',message:'Partial award'},second);assert.equal(partial.status,'partial');
});
test('readers and requesters cannot take staff approval actions',()=>{
 for(const action of ['validity','finance','review','information','decline','note','reopen','reopenFinance'])assert.throws(()=>apply(fixture(),{action},owner),e=>e.status===403);
 assert.throws(()=>apply(fixture(),{action:'withdraw'},{kerberos:'outsider',canWrite:false}),e=>e.status===404);
});
test('itemized attachment threshold is strictly greater than $1,000',()=>{
 const r=fixture();assert.deepEqual(submissionErrors(r),[]);r.request.requested=1000.01;r.request.budget[0].amount=1000.01;
 assert.match(submissionErrors(r).join(' '),/attached itemized budget/);r.files=[{kind:'supporting'}];assert(submissionErrors(r).length);r.files=[{kind:'budget'}];assert.deepEqual(submissionErrors(r),[]);
});
test('fundraising goal is never substituted for the SoE request',()=>{
 const r=fixture();r.request.requested=null;assert.equal(r.request.goal,50000);assert.match(submissionErrors(r).join(' '),/specifically requested/);
});
test('identity, directory department, approvals and audit attribution cannot be forged on save',()=>{
 const record=fixture({status:'draft'}),saved=apply(record,{action:'save',request:{...record.request,requesterName:'Spoof',requesterEmail:'spoof@example.com',department:'Spoof',correspondence:'Overwrite'},finance:{by:'spoof'},history:[]},owner);
 assert.equal(saved.request.requesterName,'Test Student');assert.equal(saved.request.requesterEmail,'studentx@mit.edu');assert.equal(saved.request.department,'Test department');assert.equal(saved.request.correspondence,'Internal email text');assert.equal(saved.finance,null);assert.equal(saved.history[0].by,'studentx');
});
test('requester response and reopening invalidate approvals; history keeps prior approvals',()=>{
 const valid=apply(fixture(),{action:'validity'}),info=apply(valid,{action:'information',message:'Please revise the budget.'},second);assert.equal(info.validity,null);assert.equal(info.finance,null);assert.equal(info.status,'information');assert.equal(info.history[0].snapshot.validity.by,'reviewera');
 const response=apply(info,{action:'save',request:{...info.request,title:'Revised workshop'}},owner),submitted=apply(response,{action:'submit'},owner);assert.equal(submitted.status,'submitted');assert.equal(submitted.validity,null);
 const approved=apply(valid,{action:'finance',amount:1000,costObject:'TEST',message:'Approved'},second);assert.throws(()=>apply(approved,{action:'save',request:approved.request}),/Reopen/);
 const reopened=apply(approved,{action:'reopen',message:'Scope changed'});assert.equal(reopened.status,'information');assert.equal(reopened.validity,null);assert.equal(reopened.history[1].snapshot.finance.costObject,'TEST');
});
test('financial amendments preserve validity but require a new independent financial approval',()=>{
 const valid=apply(fixture(),{action:'validity'}),approved=apply(valid,{action:'finance',amount:900,costObject:'OLD',message:'Partial'},second),amended=apply(approved,{action:'reopenFinance',message:'Change funding source'});
 assert.equal(amended.status,'finance');assert.equal(amended.validity.by,'reviewera');assert.equal(amended.finance,null);assert.throws(()=>apply(amended,{action:'finance',amount:900,costObject:'NEW',message:'Amended'},first),/different person/);
 assert.equal(apply(amended,{action:'finance',amount:900,costObject:'NEW',message:'Amended'},second).finance.costObject,'NEW');
});
test('requester responses and downloads never receive internal correspondence, cost objects or snapshots',()=>{
 let record=apply(fixture(),{action:'validity'});record=apply(record,{action:'finance',amount:1000,costObject:'SECRETCO',message:'Approved'},second);record=apply(record,{action:'note',message:'SECRETNOTE'});record.files=[{id:randomUUID(),kind:'correspondence',filename:'SECRETFILE.eml'},{id:randomUUID(),kind:'budget',filename:'budget.pdf'}];
 const publicData=JSON.stringify(visibleRecord(record,false));for(const secret of ['SECRETCO','SECRETNOTE','SECRETFILE','snapshot','Internal email text'])assert(!publicData.includes(secret),secret);assert.equal(visibleRecord(record,false).files.length,1);assert(visibleRecord(record,true).history.some(h=>h.message==='SECRETNOTE'));
});
test('zero and unknown amounts remain distinct and membership counts cannot conflict',()=>{
 assert.equal(money(0),0);assert.equal(money(null),null);for(const value of [-1,NaN,Infinity,1.001,'10'])assert.throws(()=>money(value));assert.throws(()=>cleanRequest({members:2,soeMembers:3}));assert.throws(()=>cleanRequest({members:1.5}));assert.equal(soePercent({members:8,soeMembers:4}),50);assert.equal(soePercent({members:0,soeMembers:0}),null);
});
test('withdrawal closes a request and preserves earlier submitted snapshots',()=>{
 const r=apply(fixture({status:'draft'}),{action:'submit'},owner),withdrawn=apply(r,{action:'withdraw'},owner);assert.equal(withdrawn.status,'withdrawn');assert.equal(withdrawn.history[0].snapshot.request.title,'Fictional workshop');assert.throws(()=>apply(withdrawn,{action:'submit'},owner));
});
