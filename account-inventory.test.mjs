import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {inventoryWorker} from './src/inventory-worker.mjs';
import {seal} from './src/nimbus-store.mjs';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import {createInventoryHandler,normalizeAccounts} from './src/account-inventory.mjs';
import {createInventoryPageHandler} from './src/account-inventory-page.mjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {parseDelimited,extractAccountRows,readAccountFile} from './public/account-inventory-parser.mjs';
const origin='https://mitsoeservices.netlify.app',rows=[{account:'9900001',name:'Fictional teaching',fundCenter:'Fictional center one',profitCenter:'Fictional parent',control:'DP',closed:'N'},{account:'9900002',name:'Fictional lab',fundCenter:'Fictional center two',profitCenter:'Fictional parent',control:'FC',closed:'N'}];
process.env.APP_ORIGIN=origin;
function setup(){
 const data=policy.initialPolicy(),entries=new Map(),key=randomBytes(32);let version=0,reads=0;
 for(const [username,scope,role]of [['daf','aeroastro','admin'],['colleague','aeroastro','admin'],['writer','aeroastro','write'],['reader','aeroastro','read'],['limited','aeroastro','limited_write'],['other','be','admin'],['fake','soe-fake','admin']])data.grants.push({username,scope,role});
 const s={async getWithMetadata(k){reads++;return structuredClone(entries.get(k))||null;},async setJSON(k,value,c={}){const old=entries.get(k);if(c.onlyIfNew&&old||c.onlyIfMatch&&c.onlyIfMatch!==old?.etag)return {modified:false};entries.set(k,{data:structuredClone(value),etag:String(++version)});return {modified:true};}};
 const authorize=username=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>username?{kerberos:username}:null,load:async()=>({data,etag:'policy'})});
 const handler=username=>createInventoryHandler({authorize:authorize(username),store:async()=>s,key:()=>key,now:()=>new Date('2026-10-27T15:00:00Z')});
 return {data,entries,key,s,authorize,handler,reads:()=>reads};
}
const get=(unit='aeroastro',extra={})=>({httpMethod:'GET',queryStringParameters:{unit,...extra}});
const post=(body,unit='aeroastro')=>({...get(unit),httpMethod:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const upload=(accounts=rows)=>({action:'draft',accounts,filename:'Fictional.csv',sha256:'a'.repeat(64),ownCredentials:true});
const decode=r=>JSON.parse(r.body);
const review=(state,selected=['9900001'])=>({action:'review',draftVersion:state.draftVersion,reviewedVersion:state.reviewedVersion,selected,confirmed:true});
test('only pilot unit administrators can view or save inventory; denials do not read storage',async()=>{
 const f=setup();
 for(const username of [null,'other','writer','reader','limited']){const before=f.reads();assert.equal((await f.handler(username)(get())).statusCode,username?403:401);assert.equal((await f.handler(username)(post(upload()))).statusCode,username?403:401);assert.equal(f.reads(),before);}
 for(const unit of ['be','school','../aeroastro'])assert.equal((await f.handler('oconaill')(get(unit))).statusCode,404);
 assert.equal((await f.handler('daf')(get('soe-fake'))).statusCode,403);assert.equal((await f.handler('fake')(get('soe-fake'))).statusCode,200);
});
test('draft is encrypted and private even from other unit or school administrators',async()=>{
 const f=setup(),state=decode(await f.handler('daf')(post(upload())));assert.equal(state.draft.accounts.length,2);assert.equal(state.reviewed,null);assert.equal(state.draft.owner,'daf');
 assert.match(state.draft.provenance,/not independently verified/);
 for(const user of ['colleague','juliekuk'])assert.equal(decode(await f.handler(user)(get('aeroastro',{owner:'daf'}))).draft,null);
 for(const entry of f.entries.values())assert.ok(!JSON.stringify(entry.data).includes('9900001'));
});
test('review saves only explicitly selected draft rows; no financial publishing or permission store is touched',async()=>{
 const f=setup(),before=JSON.stringify(f.data),state=decode(await f.handler('daf')(post(upload())));
 const response=await f.handler('daf')(post(review(state)));assert.equal(response.statusCode,200);const result=decode(response);
 assert.deepEqual(result.reviewed.accounts,[normalizeAccounts(rows)[0]]);assert.equal(result.reviewed.reviewed_by,'daf');assert.match(result.reviewed.purpose,/not a publication permission/);
 const other=decode(await f.handler('colleague')(get()));assert.equal(other.draft,null);assert.equal(other.reviewed.accounts.length,1);
 assert.equal(JSON.stringify(f.data),before);assert.ok([...f.entries.keys()].every(k=>/^(draft|reviewed):aeroastro/.test(k)));
});
test('review requires confirmation, membership in own draft and current versions',async()=>{
 const f=setup(),state=decode(await f.handler('daf')(post(upload())));
 assert.equal((await f.handler('daf')(post({...review(state),confirmed:false}))).statusCode,400);
 assert.equal((await f.handler('daf')(post(review(state,['9999999'])))).statusCode,400);
 assert.equal((await f.handler('colleague')(post(review(state)))).statusCode,409);
 assert.equal((await f.handler('daf')(post({...review(state),draftVersion:'stale'}))).statusCode,409);
 assert.equal((await f.handler('daf')(post(review(state)))).statusCode,200);
 assert.equal((await f.handler('daf')(post(review(state)))).statusCode,409);
});
test('encrypted objects cannot be substituted between units, people or draft/reviewed keys',async()=>{
 const f=setup();await f.handler('daf')(post(upload()));const entry=f.entries.get('draft:aeroastro:daf');
 for(const [target,username,unit]of [['draft:aeroastro:colleague','colleague','aeroastro'],['draft:soe-fake:fake','fake','soe-fake'],['reviewed:aeroastro','colleague','aeroastro']]){
  f.entries.set(target,structuredClone(entry));const r=await f.handler(username)(get(unit));assert.notEqual(r.statusCode,200);assert.ok(!r.body.includes('9900001'));f.entries.delete(target);
 }
 entry.data.cipher=entry.data.cipher.slice(0,-5)+'XXXXX';assert.notEqual((await f.handler('daf')(get())).statusCode,200);
});
test('removing administrator permission immediately blocks existing inventory operations',async()=>{
 const f=setup(),state=decode(await f.handler('daf')(post(upload())));f.data.grants=f.data.grants.filter(g=>g.username!=='daf');
 const before=f.reads();assert.equal((await f.handler('daf')(get())).statusCode,403);assert.equal((await f.handler('daf')(post(review(state)))).statusCode,403);assert.equal(f.reads(),before);
});
test('server rejects identity spoofing, financial columns, conflicting rows and cross-origin posts',async()=>{
 const f=setup();
 for(const body of [{...upload(),owner:'juliekuk'},upload([{...rows[0],balance:100}]),upload([{...rows[0],account:'1'}]),upload([rows[0],{...rows[0],fundCenter:'conflict'}]),{...upload(),ownCredentials:false}])assert.equal((await f.handler('daf')(post(body))).statusCode,400);
 const forged=post(upload());forged.headers.origin='https://evil.example';assert.equal((await f.handler('daf')(forged)).statusCode,403);
 assert.equal((await f.handler('daf')({...post(upload()),body:'x'.repeat(4500001)})).statusCode,413);
 assert.equal(f.entries.size,0);
});
test('inventory link appears only for administrators of the matching pilot unit, never limited pages',async()=>{
 const f=setup();
 for(const [user,unit,show]of [['daf','aeroastro',true],['fake','soe-fake',true],['writer','aeroastro',false],['reader','aeroastro',false],['oconaill','aeroastro',true]]){
  const result=await createUnitHandler(f.authorize(user))({httpMethod:'GET',path:'/units/'+unit+'/full'});assert.equal(result.statusCode,200);assert.equal(result.body.includes('/'+unit+'/account-list'),show);
  const page=await createInventoryPageHandler(f.authorize(user))({httpMethod:'GET',path:'/units/'+unit+'/account-list'});assert.equal(page.statusCode,show?200:403);
  const limited=await createUnitHandler(f.authorize(user))({httpMethod:'GET',path:'/units/'+unit+'/limited'});assert.ok(!limited.body.includes('/account-list'));
 }
 // An administrator of some other unit with read access here must not see admin tools here.
 f.data.grants.push({username:'other',scope:'aeroastro',role:'read'});const mixed=await createUnitHandler(f.authorize('other'))({httpMethod:'GET',path:'/units/aeroastro/full'});assert.ok(!mixed.body.includes('/aeroastro/account-list'));
});
test('CSV parser handles quotes and centers while stripping all financial columns before upload',async()=>{
 const csv='Cost Object,Cost Object Name,Fund Center,Profit Center,Unexpended Balance\r\n9900001,"Fictional, teaching",Center one,Parent,123456\r\n9900002,Fictional lab,Center two,Parent,987654\r\n9900002,Fictional lab,Center two,Parent,100\r\n';
 const result=extractAccountRows(parseDelimited(csv,','));assert.equal(result.length,2);assert.equal(result[0].name,'Fictional, teaching');assert.equal(result[1].fundCenter,'Center two');assert.ok(!JSON.stringify(result).includes('987654'));assert.ok(!Object.hasOwn(result[0],'balance'));
 const file=new File([csv],'Fictional.csv');assert.equal((await readAccountFile(file)).accounts.length,2);
 assert.throws(()=>parseDelimited('a,"unclosed',','));assert.throws(()=>extractAccountRows([['Cost Object','Cost Object Name','Fund Center'],['9900001','A','one'],['9900001','A','two']]));
});

test('worker inventory accepts only the owner and verifies encrypted six-column output',async()=>{
 const key=randomBytes(32),columns=['Cost Object','Cost Object Name','Fund Center','Profit Center','Control','Closed'],values=[['9900001','Fictional','Center','Parent','DP','N']],payload={columns,rows:values},id='chunk:oconaill:test-job:0',hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const manifest={owner:'oconaill',job:'test-job',reportId:'account-inventory',columns,rows:1,published_at:'2026-10-27T16:00:00Z',chunks:[{id,hash,rows:1}]};
 const objects=new Map([['latest-report:oconaill:account-inventory',manifest],[id,seal(payload,key,id)]]),s={async get(k){return objects.get(k)||null;},async getWithMetadata(){return null;}};
 const options={store:async()=>s,key:()=>key};
 await assert.rejects(inventoryWorker('read','juliekuk','soe-fake',options));await assert.rejects(inventoryWorker('read','oconaill','be',options));
 const result=await inventoryWorker('read','oconaill','soe-fake',options);assert.equal(result.accounts[0].fundCenter,'Center');assert.equal(result.accounts[0].account,'9900001');
 manifest.columns=['Balance'];await assert.rejects(inventoryWorker('read','oconaill','soe-fake',options));
});

test('using a worker extract creates only the requesting login private draft with verified provenance',async()=>{
 const f=setup();const handler=createInventoryHandler({authorize:f.authorize('oconaill'),store:async()=>f.s,key:()=>f.key,worker:async(action,owner,unit)=>{assert.equal(action,'read');assert.equal(owner,'oconaill');assert.equal(unit,'soe-fake');return {accounts:rows,sha256:'b'.repeat(64),published_at:'2026-10-27T16:00:00Z'};}});
 const result=await handler(post({action:'use-worker'},'soe-fake'));assert.equal(result.statusCode,201);const value=decode(result);assert.equal(value.draft.owner,'oconaill');assert.match(value.draft.provenance,/owner-bound worker/);assert.equal(value.reviewed,null);assert.ok([...f.entries.keys()].every(k=>k==='draft:soe-fake:oconaill'));
});
