import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createNimbusDataHandler} from './src/nimbus-data.mjs';
import {createNimbusPageHandler} from './src/nimbus-page.mjs';
import {seal,unseal} from './src/nimbus-store.mjs';
const clone=x=>x===undefined?undefined:structuredClone(x);
function fixture(){const data=policy.initialPolicy();for(const [username,scope,role] of [['unitadmin','be','admin'],['writer','be','write'],['reader','be','read'],['limited','be','limited_write'],['other','aeroastro','admin'],['schoolwriter','school','write']])data.grants.push({username,scope,role});const values=new Map(),records=new Map();let tick=0,reads=0;const store={async get(k){return clone(values.get(k)?.data)||null;},async getWithMetadata(k){return clone(values.get(k))||null;},async setJSON(k,value,options={}){const previous=values.get(k);if(options.onlyIfNew&&previous||options.onlyIfMatch&&previous?.etag!==options.onlyIfMatch)return {modified:false};values.set(k,{data:clone(value),etag:String(++tick)});return {modified:true};}};const repository={async put(scope,id,value){records.set(scope+':'+id,clone(value));},async get(scope,id){reads++;if(!records.has(scope+':'+id))throw Error('missing');return clone(records.get(scope+':'+id));}};const authorize=user=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'p'})});const handler=user=>createNimbusDataHandler({authorize:authorize(user),store:async()=>store,repository:()=>repository,accounts:async scope=>scope==='school'?null:['1234567'],query:async()=>{throw Error('Legacy path called');}});return {data,values,records,handler,authorize,reads:()=>reads};}
const row=(account='1234567',key='tx1')=>[key,'2027','202704','','','','',account,'BE Test','','','Routine spend','','staff','','1','1','100.25','-25.00'];
const get=(unit,params={})=>({httpMethod:'GET',queryStringParameters:{unit,...params}});
const post=(unit,body)=>({httpMethod:'POST',queryStringParameters:{unit},headers:{origin:'https://mitsoeservices.netlify.app','content-type':'application/json'},body:JSON.stringify(body)});
const decode=r=>JSON.parse(r.body);
process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
async function upload(f,who='writer',unit='be',rows=[row()]){const h=f.handler(who),begun=await h(post(unit,{action:'begin',rows:rows.length,filename:'Nimbus.xlsx',sha256:'a'.repeat(64)}));assert.equal(begun.statusCode,200);const run=decode(begun).run;const batch=await h(post(unit,{action:'batch',run,index:0,rows}));return {h,run,batch,finish:()=>h(post(unit,{action:'finish',run}))};}
test('Nimbus unit and legacy endpoints reject cross-unit and limited access before storage',async()=>{
 const f=fixture();for(const user of ['unitadmin','writer','reader','limited','other','schoolwriter',null]){
  assert.equal((await f.handler(user)(get('school',{source:'legacy'}))).statusCode,user?403:401);
  assert.equal((await f.handler(user)(get('be',{source:'legacy'}))).statusCode,user?403:401);
 }
 assert.equal(f.reads(),0);
 for(const user of ['unitadmin','writer','reader','oconaill'])assert.equal((await f.handler(user)(get('be',{action:'status'}))).statusCode,200);
 for(const user of ['limited','other'])assert.equal((await f.handler(user)(get('be',{action:'status'}))).statusCode,403);
 assert.equal((await createNimbusPageHandler(f.authorize('unitadmin'))({httpMethod:'GET',path:'/units/aeroastro/nimbus',queryStringParameters:{unit:'be'}})).statusCode,403);
 assert.equal((await createNimbusPageHandler(f.authorize('limited'))({httpMethod:'GET',path:'/units/be/nimbus'})).statusCode,403);
});
test('verified exports persist for unit readers and are searchable without another refresh',async()=>{
 const f=fixture(),u=await upload(f);assert.equal(u.batch.statusCode,200);assert.equal((await f.handler('reader')(get('be'))).statusCode,200);assert.equal(decode(await f.handler('reader')(get('be'))).total,0);
 assert.equal((await u.finish()).statusCode,200);
 const result=decode(await f.handler('reader')(get('be',{q:'routine',year:'2027'})));assert.equal(result.total,1);assert.equal(result.rows[0][17],'100.25');assert.ok(result.refreshed_at);
 assert.equal(decode(await f.handler('reader')(get('be',{exclude:'routine'}))).total,0);
 assert.equal((await f.handler('reader')(post('be',{action:'begin'}))).statusCode,403);
 assert.equal((await f.handler('other')(get('be'))).statusCode,403);
});
test('unmapped accounts, incomplete uploads, duplicates, and concurrency never replace a saved snapshot',async()=>{
 const f=fixture(),first=await upload(f);await first.finish();const old=clone(f.values.get('head:be'));
 const bad=await upload(f,'writer','be',[row('7654321')]);assert.equal(bad.batch.statusCode,400);assert.equal((await bad.finish()).statusCode,400);assert.deepEqual(f.values.get('head:be'),old);
 const dupe=await upload(f,'writer','be',[row(),row()]);assert.equal((await dupe.finish()).statusCode,400);assert.deepEqual(f.values.get('head:be'),old);
 const a=await upload(f,'writer','be',[row('1234567','a')]),b=await upload(f,'writer','be',[row('1234567','b')]);assert.equal((await a.finish()).statusCode,200);assert.equal((await b.finish()).statusCode,409);
});
test('snapshot refreshes require same-origin JSON, current write access, and the initiating login',async()=>{
 const f=fixture(),u=await upload(f);const foreign=post('be',{action:'finish',run:u.run});foreign.headers.origin='https://evil.example';assert.equal((await u.h(foreign)).statusCode,403);
 assert.equal((await f.handler('unitadmin')(post('be',{action:'finish',run:u.run}))).statusCode,403);
 f.data.grants=f.data.grants.filter(g=>g.username!=='writer');assert.equal((await u.finish()).statusCode,403);
});
test('encrypted snapshots bind ciphertext to scope and chunk identity and reject tampering',()=>{
 const key=randomBytes(32),cipher=seal([row()],key,'be:id');assert.ok(!cipher.includes('BE Test'));assert.deepEqual(unseal(cipher,key,'be:id'),[row()]);assert.throws(()=>unseal(cipher,key,'aeroastro:id'));assert.throws(()=>unseal(cipher,randomBytes(32),'be:id'));assert.throws(()=>unseal(cipher.slice(0,-4)+'xxxx',key,'be:id'));
});
test('wrong-scope heads and corrupted data fail closed with no legacy fallback',async()=>{
 const f=fixture(),u=await upload(f);await u.finish();const head=f.values.get('head:be');head.data.scope='aeroastro';assert.equal((await f.handler('reader')(get('be'))).statusCode,503);head.data.scope='be';const id='be:'+head.data.run+':0';f.records.set('be:'+id,[row('7654321')]);assert.equal((await f.handler('reader')(get('be'))).statusCode,503);
});
