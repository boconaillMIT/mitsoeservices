import test from 'node:test';import assert from 'node:assert/strict';
import {createPersonnelRecordsHandler,personnelVersion} from './src/aeroastro-personnel-records.mjs';
import {createFinanceHandler,financeHtml} from './src/aeroastro-finance.mjs';
import {validateFinanceSource} from './src/aeroastro-finance-source.mjs';
import {preparePersonnelRefresh,HR_COLUMNS} from './public/aeroastro-personnel-refresh-model.mjs';
const row=(id,missing=false)=>({id,department:'Aeronautics and Astronautics',employeeId:id==='current'?'999999991':'999999992',name:'Example '+id,email:'example@example.test',category:'Example',jobTitle:'Example role',position:'Example role',positionId:id==='current'?'990001':'990002',startDate:'2020-01-01',endDate:null,openEnded:true,salary:80000,hourlyRate:0,fte:100,additionalAppointments:false,inCurrentRoster:!missing,lastSeenDate:'2026-11-19'});
const source=()=>({schema:1,unit:'aeroastro',kind:'people',asOf:'2026-11-19',label:'Fictional roster',sourceHash:'a'.repeat(64),rows:[row('current'),row('former',true)]});
const auth={user:{kerberos:'example'},kerberos:'example',canWrite:true,navigation:{}};
const event=b=>({path:'/units/aeroastro/finance/personnel-records',httpMethod:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(b)});
function fixture(){let current=source(),writes=0;const keys=new Map([['current','1'.repeat(64)],['former','2'.repeat(64)]]);return {repo:{snapshot:async()=>current,peopleDetails:async s=>s,personKeys:async()=>keys,refreshPeople:async(prev,next)=>{assert.equal(prev,current);current=next;writes++;return {saved:true};}},get:()=>current,writes:()=>writes,keys};}
const handler=()=>createPersonnelRecordsHandler({now:()=>new Date('2026-11-27T12:00:00Z'),uuid:()=> '11111111-1111-4111-8111-111111111111'});
test('Deleting and restoring former appointments preserves every original fact and private-note identity; stamps are server-owned',async()=>{
 process.env.APP_ORIGIN='https://example.test';const f=fixture(),h=handler(),original=structuredClone(f.get());
 let r=await h(event({operation:'delete',id:'former',version:personnelVersion(f.get())}),auth,f.repo);assert.equal(r.statusCode,200);assert.equal(f.writes(),1);
 const deleted=f.get().rows[1];assert.equal(deleted.deletedBy,'example');assert.equal(deleted.deletedAt,'2026-11-27T12:00:00.000Z');const {deletedAt,deletedBy,...facts}=deleted;assert.deepEqual(facts,original.rows[1]);assert.deepEqual(f.get().rows[0],original.rows[0]);
 assert.deepEqual(f.get().personIdentities.rows,[{appointmentId:'current',personKey:f.keys.get('current')},{appointmentId:'former',personKey:f.keys.get('former')}]);
 r=await h(event({operation:'restore',id:'former',version:personnelVersion(f.get())}),auth,f.repo);assert.equal(r.statusCode,200);assert.deepEqual(f.get().rows,original.rows);assert.equal(f.writes(),2);
});
test('Roster deletion rejects current staff, foreign IDs, stale pages, forged fields, readers, cross-origin requests and non-POST methods',async()=>{
 process.env.APP_ORIGIN='https://example.test';const f=fixture(),h=handler(),base={operation:'delete',id:'former',version:personnelVersion(f.get())};
 for(const [body,status]of [[{...base,id:'current'},409],[{...base,id:'foreign'},404],[{...base,version:'b'.repeat(64)},409],[{...base,deletedBy:'forged'},400],[{...base,operation:'restore'},409]])assert.equal((await h(event(body),auth,f.repo)).statusCode,status);
 assert.equal((await h(event(base),{...auth,canWrite:false},f.repo)).statusCode,403);assert.equal((await h({...event(base),headers:{Origin:'https://foreign.test','Content-Type':'application/json'}},auth,f.repo)).statusCode,403);assert.equal((await h({...event(base),httpMethod:'GET'},auth,f.repo)).statusCode,405);assert.equal(f.writes(),0);
});
test('Concurrent writes and incomplete private identities fail safely',async()=>{
 process.env.APP_ORIGIN='https://example.test';const f=fixture(),body={operation:'delete',id:'former',version:personnelVersion(f.get())};
 assert.equal((await handler()(event(body),auth,{...f.repo,refreshPeople:async()=>({conflict:true})})).statusCode,409);
 assert.equal((await handler()(event(body),auth,{...f.repo,personKeys:async()=>new Map()})).statusCode,503);assert.equal(f.writes(),0);
});
test('Deleted appointments stay deleted while absent from future reports and automatically return when reported again',()=>{
 const s=source();s.rows[1].deletedBy='example';s.rows[1].deletedAt='2026-11-27T12:00:00Z';
 const csv=rows=>Object.values(HR_COLUMNS).join('\t')+'\n'+rows.map(r=>Object.keys(HR_COLUMNS).map(k=>typeof r[k]==='boolean'?r[k]?'Yes':'No':r[k]??'').join('\t')).join('\n');
 let p=preparePersonnelRefresh(csv([s.rows[0]]),s,'2026-11-27');assert.equal(p.rows[1].deletedBy,'example');
 p=preparePersonnelRefresh(csv(s.rows),s,'2026-11-27');assert.equal(p.rows[1].deletedAt,undefined);assert.equal(p.rows[1].id,'former');assert.equal(p.rows[1].inCurrentRoster,true);assert(p.changes.some(c=>c.type==='Returned'));
});
test('Source validation disallows tombstones on current appointments and malformed audit stamps',()=>{
 for(const changes of [{deletedBy:'example',deletedAt:'bad'},{deletedBy:'<script>',deletedAt:'2026-11-27T12:00:00Z'},{deletedBy:'example',deletedAt:'2026-11-27T12:00:00Z',inCurrentRoster:true}]){const s=source();Object.assign(s.rows[1],changes);assert.throws(()=>validateFinanceSource(s,'people',new Date('2026-11-27')));}
});
test('People view exposes separate roster sections and versioned management only to finance writers',async()=>{
 const f=fixture();for(const canWrite of [false,true]){const h=createFinanceHandler({authorize:async(e,required)=>{assert.equal(required.scope,'finance:aeroastro');return {...auth,canWrite};},repository:()=>f.repo});const r=await h({path:'/units/aeroastro/finance/data',httpMethod:'GET',queryStringParameters:{view:'people'}}),d=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(d.canManagePeople,canWrite);assert.equal(d.version,personnelVersion(f.get()));}
 const html=financeHtml('people',auth);assert.match(html,/<h2>Latest roster<\/h2>/);assert.match(html,/<h2>Not on latest roster<\/h2>/);assert.match(html,/finance-deleted-list/);
});
