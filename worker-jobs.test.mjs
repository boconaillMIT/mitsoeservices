import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,randomBytes} from 'node:crypto';
import {createJobDispatcher,dueWindow,approvedDefinition,readTabularResult} from './src/worker-jobs.mjs';
import {defaults} from './src/report-settings.mjs';
function memory(){const values=new Map();let v=0;return {values,async get(k,options){const value=values.get(k)?.data;return value===undefined?null:structuredClone(value);},async getWithMetadata(k){return values.has(k)?structuredClone(values.get(k)):null;},async setJSON(k,data,options={}){const old=values.get(k);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};values.set(k,{data:structuredClone(data),etag:String(++v)});return {modified:true};},async set(k,data){values.set(k,{data,etag:String(++v)});return {modified:true};}};}
async function fixture(extra=[],options={}){const store=memory(),settings=memory(),pair=generateKeyPairSync('ed25519'),key=randomBytes(32),device={id:'wkp_'+'1'.repeat(24),owner:'oconaill',expires_at:'2027-01-01T00:00:00Z',revoked:false};await store.setJSON('device:'+device.id,device);const reports=[{id:'balances',name:'Balances',minimumRole:'admin',runner:'soe-account-outlook-v1'},...extra];await settings.setJSON('catalogue',{schema:1,reports});const preferences=defaults(reports);for(const r of Object.values(preferences.reports))r.enabled=true;await settings.setJSON('preferences:oconaill',{owner:'oconaill',preferences});const dispatch=createJobDispatcher({settings:async()=>settings,now:()=>new Date('2026-10-26T14:15:00Z'),key:()=>key,signJob:payload=>sign(null,Buffer.from(payload),pair.privateKey).toString('base64url'),...options});const call=body=>dispatch({body,device,store});const check=()=>call({action:'check-in',worker_version:'2.0.0',capabilities:['soe-account-outlook-v1','oracle-tabular-v1']});return {store,settings,device,pair,key,call,check};}
const jobFrom=r=>JSON.parse(Buffer.from(r.data.job.envelope,'base64url').toString());

test('an owner-bound queued manual request runs once without enabling a schedule',async()=>{
 const report={id:'account-inventory',name:'Inventory',minimumRole:'admin',owners:['oconaill'],runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',bindings:{},max_rows:20000}};
 const f=await fixture([report]);const p=await f.settings.get('preferences:oconaill');p.preferences.paused=true;for(const r of Object.values(p.preferences.reports))r.enabled=false;await f.settings.setJSON('preferences:oconaill',p);
 await f.store.setJSON('manual-request:oconaill',{owner:'wrong',reportId:report.id,expires_at:'2026-10-26T15:00:00Z'});assert.equal((await f.check()).data.job,null);
 await f.store.setJSON('manual-request:oconaill',{owner:'oconaill',reportId:report.id,expires_at:'2026-10-26T15:00:00Z'});
 const first=await f.check(),job=jobFrom(first);assert.equal(job.reportId,report.id);assert.equal((await f.store.get('manual-request:oconaill')).claimed,job.id);
 const columns=['Cost Object'],rows=[['9900001']];assert.equal((await f.call({action:'batch',job:job.id,index:0,columns,rows})).status,200);assert.equal((await f.call({action:'complete',job:job.id,rows:1})).status,200);
 assert.equal((await f.check()).data.job,null);assert.equal((await f.settings.get('preferences:oconaill')).preferences.reports[report.id].enabled,false);
});
test('schedule calculations handle weekly DST, monthly last-day, and missed-run policy',()=>{
 assert.equal(dueWindow({frequency:'weekly',day:'1',time:'09:00'},'America/New_York',new Date('2026-11-02T14:05:00Z'),false),'2026-11-02T14:00:00.000Z');
 assert.equal(dueWindow({frequency:'monthly',day:'last',time:'09:30'},'America/New_York',new Date('2026-10-31T14:00:00Z'),true),'2026-10-31T13:30:00.000Z');
 assert.equal(dueWindow({frequency:'daily',day:'1',time:'09:00'},'America/New_York',new Date('2026-10-26T18:00:00Z'),false),null);
});
test('claims are signed, pauses prevent new jobs, and leases prevent duplicate runs',async()=>{
 const f=await fixture(),first=await f.check();assert.equal(first.status,200);const encoded=Buffer.from(first.data.job.envelope,'base64url');assert.equal(verify(null,encoded,f.pair.publicKey,Buffer.from(first.data.job.signature,'base64url')),true);const job=jobFrom(first);assert.equal(job.owner,'oconaill');assert.equal(job.device,f.device.id);assert.equal((await f.check()).data.job,null);
 await f.call({action:'failed',job:job.id});const p=await f.settings.get('preferences:oconaill');p.preferences.paused=true;await f.settings.setJSON('preferences:oconaill',p);assert.equal((await f.check()).data.job,null);
});
test('completion persists only the private pilot, records due-window success, and refuses replay',async()=>{
 const f=await fixture(),job=jobFrom(await f.check()),result={view:'all',period:'202704',retrieved:'2026-10-26T14:00:00Z',rows:[{key:'1234567',name:'Test',deans_discretionary:false,balance:'10',projected:'1',estimate:'2',after:'7',actual:'0'}]};assert.equal((await f.call({action:'complete',job:job.id,result})).status,200);assert.equal((await f.check()).data.job,null);assert.ok(await f.store.get('latest:oconaill'));assert.equal(await f.store.get('latest'),null);assert.equal((await f.call({action:'complete',job:job.id,result})).status,200);assert.equal((await f.call({action:'complete',job:job.id,result:{...result,retrieved:'2026-10-27T14:00:00Z'}})).status,409);
});
test('centrally added query definitions run without a new worker, remain encrypted, and reject tampering',async()=>{
 const sql={id:'test-query',name:'New approved report',minimumRole:'admin',runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',max_rows:1000}},f=await fixture([sql]);const p=await f.settings.get('preferences:oconaill');p.preferences.reports.balances.enabled=false;await f.settings.setJSON('preferences:oconaill',p);const job=jobFrom(await f.check());assert.equal(job.reportId,'test-query');assert.equal((await f.call({action:'batch',job:job.id,index:0,columns:['Account'],rows:[['1234567']]})).status,200);assert.ok(!JSON.stringify([...f.store.values.values()]).includes('"rows":[["1234567"]]'));assert.equal((await f.call({action:'complete',job:job.id,rows:2})).status,400);assert.equal((await f.call({action:'complete',job:job.id,rows:1})).status,200);const read=await readTabularResult(f.store,'oconaill','test-query',1,()=>f.key);assert.deepEqual(read.rows,[['1234567']]);assert.equal(await readTabularResult(f.store,'juliekuk','test-query',1,()=>f.key),null);
});
test('write statements, missing access views, expired leases, and revoked devices are refused',async()=>{
 for(const sql of ['DELETE FROM X','SELECT * FROM X','SELECT * FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE; DROP TABLE X'])assert.throws(()=>approvedDefinition({runner:'oracle-tabular-v1',definition:{sql}}));
 const f=await fixture();const job=jobFrom(await f.check());const active=await f.store.get('active:oconaill');active.expires_at='2026-10-25T00:00:00Z';await f.store.setJSON('active:oconaill',active);assert.equal((await f.call({action:'complete',job:job.id,rows:1})).status,409);await f.store.setJSON('device:'+f.device.id,{...f.device,revoked:true});assert.equal((await f.check()).status,403);
});
test('adding a catalogue report preserves existing schedules and leaves the new report off',async()=>{
 const f=await fixture();const catalogue=await f.settings.get('catalogue');catalogue.reports.push({id:'added-later',name:'Added later',minimumRole:'admin',runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',max_rows:10}});await f.settings.setJSON('catalogue',catalogue);const response=await f.check();assert.equal(response.status,200);assert.equal(jobFrom(response).reportId,'balances');
});
test('a disconnected worker checks in without claiming a due report or changing its last saved result',async()=>{
 const f=await fixture();await f.store.setJSON('latest:oconaill',{marker:'previous saved report'});
 const response=await f.call({action:'check-in',worker_version:'2.0.0',capabilities:['soe-account-outlook-v1'],source_available:false});
 assert.equal(response.data.job,null);assert.match(response.data.status,/MIT network or VPN/);assert.equal(await f.store.get('active:oconaill'),null);assert.deepEqual(await f.store.get('latest:oconaill'),{marker:'previous saved report'});
 assert.equal((await f.store.get('device:'+f.device.id)).source_available,false);
 assert.equal(jobFrom(await f.check()).reportId,'balances');
});
test('Nimbus completion publishes only a private pilot pointer after all saved batches succeed',async()=>{
 const {NIMBUS_COLUMNS,saveNimbusPilotBatch}=await import('./src/nimbus-worker.mjs'),records=new Map(),repository={async put(scope,id,rows){records.set(scope+':'+id,structuredClone(rows));},async get(scope,id){return structuredClone(records.get(scope+':'+id));}};
 const report={id:'nimbus',name:'Nimbus',minimumRole:'admin',runner:'oracle-tabular-v1',validation:'verified',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',max_rows:2000000,output:{kind:'nimbus-snapshot-v1',scope:'school',visibility:'owner-pilot'}}};
 const f=await fixture([report],{nimbusBatch:(job,body)=>saveNimbusPilotBatch(job,body,repository)}),prefs=await f.settings.get('preferences:oconaill');prefs.preferences.reports.balances.enabled=false;await f.settings.setJSON('preferences:oconaill',prefs);
 await f.store.setJSON('latest-report:oconaill:nimbus',{marker:'previous'});await f.store.setJSON('head:school',{marker:'shared SoE data'});
 const job=jobFrom(await f.check()),rows=[['tx1','2027','202704','','45000','','','1234567','Test','','','','','','','1','1','100','0']];
 assert.equal((await f.call({action:'batch',job:job.id,index:0,columns:NIMBUS_COLUMNS,rows})).status,200);
 assert.equal((await f.call({action:'complete',job:job.id,rows:2})).status,400);assert.deepEqual(await f.store.get('latest-report:oconaill:nimbus'),{marker:'previous'});
 assert.equal((await f.call({action:'complete',job:job.id,rows:1})).status,200);const manifest=await f.store.get('latest-report:oconaill:nimbus');assert.equal(manifest.storage,'quickbase-nimbus-pilot-v2');assert.equal(manifest.scope,'worker-pilot-oconaill-school');assert.deepEqual(await f.store.get('head:school'),{marker:'shared SoE data'});assert.equal(await f.store.get('latest'),null);
});
test('owner-restricted report definitions cannot be dispatched to another owner',async()=>{
 const report={id:'private-query',name:'Private',owners:['differentuser'],minimumRole:'admin',runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',max_rows:10}},f=await fixture([report]);const p=await f.settings.get('preferences:oconaill');p.preferences.reports.balances.enabled=false;await f.settings.setJSON('preferences:oconaill',p);assert.equal((await f.check()).data.job,null);
});
test('lost check-in responses replay the same signed job only for the same request and device',async()=>{
 const f=await fixture(),body={action:'check-in',worker_version:'2.0.3',capabilities:['soe-account-outlook-v1'],client_request_id:'12345678-1234-1234-1234-123456789012'},a=jobFrom(await f.call(body)),b=jobFrom(await f.call(body));assert.equal(a.id,b.id);assert.equal((await f.call({...body,client_request_id:'87654321-1234-1234-1234-123456789012'})).data.job,null);
});
test('batch and completion retries are acknowledged without duplicate rows or publication',async()=>{
 const f=await fixture([{id:'query',name:'Query',minimumRole:'admin',runner:'oracle-tabular-v1',definition:{sql:'SELECT COST_COLLECTOR_ID FROM WAREUSER.COST_COLLECTORS_ACCESSIBLE',max_rows:10}}]),p=await f.settings.get('preferences:oconaill');p.preferences.reports.balances.enabled=false;await f.settings.setJSON('preferences:oconaill',p);const job=jobFrom(await f.check()),body={action:'batch',job:job.id,index:0,columns:['Account'],rows:[['1234567']]};assert.equal((await f.call(body)).status,200);assert.equal((await f.call(body)).data.replayed,true);assert.equal((await f.store.get('active:oconaill')).rows,1);assert.equal((await f.call({...body,rows:[['7654321']]})).status,409);assert.equal((await f.call({action:'complete',job:job.id,rows:1})).status,200);const before=await f.store.get('latest-report:oconaill:query');assert.equal((await f.call({action:'complete',job:job.id,rows:1})).data.replayed,true);assert.deepEqual(await f.store.get('latest-report:oconaill:query'),before);assert.equal((await f.store.get('activity:oconaill')).length,1);
});
