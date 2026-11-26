import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createDrStore} from './src/dr-store.mjs';
const labels=['Key','Owner','Organization Key','Record JSON','Revision'],fields=Object.fromEntries(labels.map((label,i)=>[label,i+6]));
function harness({stale=false,reject=false,total=1}={}){
 const record={id:randomUUID(),owner:'studentx',organizationId:randomUUID(),revision:randomUUID(),history:[]},calls=[],row=()=>({'3':{value:1},...Object.fromEntries(Object.entries({Key:record.id,Owner:record.owner,'Organization Key':record.organizationId,'Record JSON':JSON.stringify(record),Revision:record.revision}).map(([key,value])=>[fields[key],{value}]))});
 const transport={async rest(path,{body}={}){calls.push({path,body});if(path.startsWith('fields?'))return labels.map(label=>({id:fields[label],label}));if(path==='records/query')return {data:[row()],metadata:{totalRecords:total}};throw Error('Unexpected REST call');},async native(table,action,body){calls.push({action,body});if(action==='API_GetRecordInfo')return `<qdbapi><update_id>native-cas-123</update_id><field><fid>${fields.Revision}</fid><value>${stale?'newer-revision':record.revision}</value></field></qdbapi>`;if(action==='API_EditRecord'){if(reject)throw Object.assign(Error('Concurrent edit'),{qbCode:'77'});return '<qdbapi><errcode>0</errcode></qdbapi>';}throw Error('Unexpected native call');}};
 return {record,calls,store:createDrStore({transport,tables:{requests:'btest123',files:'bfiles12',organizations:'borg1234'}})};
}
test('storage scopes requester queries by owner and validates query identifiers',async()=>{
 const h=harness();await h.store.list({owner:'studentx'});assert.equal(h.calls.find(c=>c.path==='records/query').body.where,"{7.EX.'studentx'}");await assert.rejects(()=>h.store.list({owner:"x'}OR{3.GT.0}"}),/Invalid identifier/);
});
test('saves require both the application revision and QuickBase native update ID',async()=>{
 const h=harness(),next={...h.record,revision:randomUUID(),history:[{action:'validity',by:'reviewera'}]};await h.store.save(next,h.record.revision);const edit=h.calls.find(c=>c.action==='API_EditRecord');assert.match(edit.body,/<update_id>native-cas-123<\/update_id>/);assert.match(edit.body,/&quot;action&quot;:&quot;validity&quot;/);
});
test('stale application and native revisions never reach an edit',async()=>{
 for(const stale of [false,true]){const h=harness({stale});await assert.rejects(()=>h.store.save({...h.record,revision:randomUUID()},stale?h.record.revision:'stale'),error=>error.status===409);assert(!h.calls.some(c=>c.action==='API_EditRecord'));}
});
test('QuickBase conflict during native edit is returned as a conflict',async()=>{
 const h=harness({reject:true});await assert.rejects(()=>h.store.save({...h.record,revision:randomUUID()},h.record.revision),e=>e.status===409);
});
test('incomplete paginated results fail closed instead of displaying partial totals',async()=>{
 const h=harness({total:100001});await assert.rejects(()=>h.store.list(),/Incomplete request results/);
});
