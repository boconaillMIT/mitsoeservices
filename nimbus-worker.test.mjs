import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {NIMBUS_COLUMNS,checkNimbusPilot,saveNimbusPilotBatch,readNimbusPilotPage} from './src/nimbus-worker.mjs';
import {approvedDefinition} from './src/worker-jobs.mjs';import {createSnapshotRepository,sealCompressed,unsealCompressed} from './src/nimbus-store.mjs';
const job=()=>({id:'12345678-1234-1234-1234-123456789012',owner:'oconaill',reportId:'nimbus',definition:{output:{kind:'nimbus-snapshot-v1',scope:'school',visibility:'owner-pilot'}}});
const row=()=>['tx1','2027','202704','','45000','Type','Code','1234567','Test account','1','GL','Text','','staff','reviewer','1','1','100.25','-25.00'];
function fixture(){const records=new Map(),key=randomBytes(32),query=async(path,b)=>{if(path==='records'){const value=b.data[0];records.set(value['6'].value,value);return {data:[{'3':{value:1}}]};}const id=/{6.EX.'([^']+)'}/.exec(b.where)[1],record=records.get(id);return {data:record?[record]:[],metadata:{totalRecords:record?1:0}};};return {records,repository:createSnapshotRepository({table:'btest',key:()=>key,query})};}
test('Nimbus automatic output refuses other owners, other units, and shared publication',()=>{
 for(const modify of [j=>j.owner='juliekuk',j=>j.reportId='other',j=>j.definition.output.scope='be',j=>j.definition.output.visibility='shared',j=>j.definition.output.arbitraryScope='aeroastro']){const j=job();modify(j);assert.throws(()=>checkNimbusPilot(j));}
 assert.equal(checkNimbusPilot(job()),'worker-pilot-oconaill-school');
 const report={id:'nimbus',runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',...job().definition}};
 assert.throws(()=>approvedDefinition(report),/verified/);assert.ok(approvedDefinition({...report,validation:'verified'}).output);
});
test('worker rows are encrypted in Quickbase and can be read only from the private pilot manifest',async()=>{
 const f=fixture(),j=job(),chunk=await saveNimbusPilotBatch(j,{index:0,columns:NIMBUS_COLUMNS,rows:[row()]},f.repository);
 assert.ok(!JSON.stringify([...f.records.values()]).includes('Test account'));
 const manifest={owner:j.owner,reportId:j.reportId,job:j.id,storage:'quickbase-nimbus-pilot-v1',scope:checkNimbusPilot(j),rows:1,columns:NIMBUS_COLUMNS,chunks:[chunk],published_at:'2026-10-26T20:00:00Z'};
 const result=await readNimbusPilotPage(manifest,'oconaill','nimbus',1,f.repository);assert.deepEqual(result.rows,[row()]);
 await assert.rejects(readNimbusPilotPage(manifest,'juliekuk','nimbus',1,f.repository));await assert.rejects(readNimbusPilotPage({...manifest,scope:'be'},'oconaill','nimbus',1,f.repository));
 const record=f.records.get(chunk.id);record['7'].value='be';await assert.rejects(readNimbusPilotPage(manifest,'oconaill','nimbus',1,f.repository));
});
test('incorrect columns, malformed rows, and corrupted or incomplete manifests are rejected',async()=>{
 const f=fixture(),j=job();await assert.rejects(saveNimbusPilotBatch(j,{index:0,columns:[...NIMBUS_COLUMNS].reverse(),rows:[row()]},f.repository));
 const bad=row();bad[7]='not-account';await assert.rejects(saveNimbusPilotBatch(j,{index:0,columns:NIMBUS_COLUMNS,rows:[bad]},f.repository));
 const chunk=await saveNimbusPilotBatch(j,{index:0,columns:NIMBUS_COLUMNS,rows:[row()]},f.repository),manifest={owner:j.owner,reportId:j.reportId,job:j.id,storage:'quickbase-nimbus-pilot-v1',scope:checkNimbusPilot(j),rows:2,columns:NIMBUS_COLUMNS,chunks:[chunk]};
 await assert.rejects(readNimbusPilotPage(manifest,'oconaill','nimbus',1,f.repository));manifest.rows=1;manifest.chunks[0].hash='bad';await assert.rejects(readNimbusPilotPage(manifest,'oconaill','nimbus',1,f.repository));
});
test('compressed chunks reject tampering and cannot be moved across scopes',()=>{
 const key=randomBytes(32),rows=Array.from({length:250},row),cipher=sealCompressed(rows,key,'scope:id');assert.ok(cipher.length<JSON.stringify(rows).length/2);assert.deepEqual(unsealCompressed(cipher,key,'scope:id'),rows);assert.throws(()=>unsealCompressed(cipher,key,'other:id'));assert.throws(()=>unsealCompressed(cipher.slice(0,-4)+'AAAA',key,'scope:id'));
});
test('unchanged batches are reused across runs instead of storing another full copy',async()=>{
 const f=fixture(),first=job(),body={index:0,columns:NIMBUS_COLUMNS,rows:[row()]},a=await saveNimbusPilotBatch(first,body,f.repository),cipher=f.records.get(a.id)['8'].value;
 const second={...job(),id:'87654321-1234-1234-1234-123456789012'},b=await saveNimbusPilotBatch(second,body,f.repository);assert.equal(a.id,b.id);assert.equal(f.records.size,1);assert.equal(f.records.get(a.id)['8'].value,cipher);assert.ok(cipher.startsWith('gz1.'));
 const manifest={owner:'oconaill',reportId:'nimbus',job:second.id,storage:'quickbase-nimbus-pilot-v2',scope:checkNimbusPilot(second),rows:1,columns:NIMBUS_COLUMNS,chunks:[b]};assert.deepEqual((await readNimbusPilotPage(manifest,'oconaill','nimbus',1,f.repository)).rows,[row()]);
});
