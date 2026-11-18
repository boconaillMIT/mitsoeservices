import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import units from './src/units.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createAcademicHandler} from './src/unit-hub.mjs';
import {createUnitDataHandler} from './src/unit-data.mjs';
import {createAdminHandler} from './src/admin-api.mjs';
function store(){let data=null,v=0;return {async getWithMetadata(){return data?{data:structuredClone(data),etag:String(v)}:null;},async setJSON(k,value,c={}){if(c.onlyIfNew&&data||c.onlyIfMatch&&c.onlyIfMatch!==String(v))return {modified:false};data=structuredClone(value);v++;return {modified:true};}};}
async function add(s,username,scope,role,actor='oconaill'){const p=await policy.loadPolicy(s);return policy.changePolicy(actor,'add',username,p.etag,s,{scope,role});}
function asUser(s,username){return (event,options={})=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:username}),load:()=>policy.loadPolicy(s)});}
const event=(scope,section)=>({httpMethod:'GET',path:'/units/'+scope+'/'+section,queryStringParameters:{}});
test('each of the five levels enforces limited/full/wallet and write capabilities for every unit',async()=>{
 for(const scope of Object.keys(units.UNITS))for(const role of Object.keys(policy.ROLES)){
  const s=store();assert.equal((await add(s,'test_user',scope,role)).status,200);const authorize=asUser(s,'test_user');
  const page=createUnitHandler(authorize),limited=role.startsWith('limited_');
  assert.equal((await page(event(scope,'limited'))).statusCode,200);
  assert.equal((await page(event(scope,'full'))).statusCode,limited?403:200);
  assert.equal((await page(event(scope,'wallet'))).statusCode,limited?403:200);
  assert.equal((await authorize({},{scope,audience:'limited',minimum:'write'})).statusCode===403,!['limited_write','write','admin'].includes(role));
  assert.equal((await authorize({},{scope,minimum:'write'})).statusCode===403,!['write','admin'].includes(role));
  if(limited){let reads=0;const api=createUnitDataHandler({authorize,read:async()=>{reads++;}});assert.equal((await api({httpMethod:'GET',queryStringParameters:{unit:scope}})).statusCode,403);assert.equal(reads,0);}
 }
});
test('limited directories expose only permitted limited pages and contain no wallet links',async()=>{
 const s=store();await add(s,'junior','aeroastro','limited_read');const authorize=asUser(s,'junior');
 const directory=await createAcademicHandler(authorize)({httpMethod:'GET'});
 assert.equal(directory.statusCode,200);assert.ok(directory.body.includes('AeroAstro Limited Access'));assert.ok(!directory.body.includes('AeroAstro Full access'));assert.ok(!directory.body.includes('/units/be/'));
 const limited=await createUnitHandler(authorize)(event('aeroastro','limited'));assert.ok(!limited.body.includes('/wallet'));assert.ok(!limited.body.includes('wallet.js'));
 assert.equal((await createUnitHandler(authorize)(event('aeroastro','full'))).statusCode,403);
});
test('unit administrators can manage their unit only, including delegated unit administrators',async()=>{
 const s=store();await add(s,'aero_admin','aeroastro','admin');
 for(const scope of Object.keys(policy.SCOPES).filter(s=>s!=='aeroastro')){
  const before=await policy.loadPolicy(s);
  assert.equal((await policy.changePolicy('aero_admin','add','target',before.etag,s,{scope,role:'admin'})).status,403);
  assert.equal((await policy.changePolicy('aero_admin','remove','juliekuk',before.etag,s,{scope})).status,403);
 }
 for(const role of Object.keys(policy.ROLES))assert.equal((await add(s,'target','aeroastro',role,'aero_admin')).status,200);
 const state=await policy.loadPolicy(s);assert.equal(policy.effectiveRole(state.data,'target','aeroastro'),'admin');assert.equal(policy.effectiveRole(state.data,'target','be'),null);assert.equal(policy.effectiveRole(state.data,'target','school'),null);
 assert.deepEqual(policy.managedScopes(state.data,'aero_admin'),['aeroastro']);
});
test('unit admin API hides other scopes, grants and audit; forged cross-unit POST is denied',async()=>{
 const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.test';
 try{
  const s=store();await add(s,'unit_admin','aeroastro','admin');await add(s,'other_person','be','read');
  const handler=createAdminHandler({authorize:asUser(s,'unit_admin'),change:(actor,action,username,etag,unused,options)=>policy.changePolicy(actor,action,username,etag,s,options)});
  const get=await handler(new Request('https://example.test/.netlify/functions/admin-access'));assert.equal(get.status,200);
  const view=await get.json();assert.deepEqual(Object.keys(view.scopes),['aeroastro']);assert.ok(view.grants.every(g=>g.scope==='aeroastro'));assert.ok(view.audit.every(a=>a.scope==='aeroastro'));assert.ok(!view.users.includes('other_person'));
  assert.equal(view.roleLabels.aeroastro.admin,'Administrator (unit-wide)');assert.equal(Object.keys(view.roleLabels.aeroastro).length,5);
  const request=scope=>new Request('https://example.test/.netlify/functions/admin-access',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'add',username:'target',scope,role:'admin',version:view.version})});
  assert.equal((await handler(request('school'))).status,403);assert.equal((await handler(request('be'))).status,403);assert.equal((await handler(request('aeroastro'))).status,200);
 }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});
test('existing full grants keep financial access; school and local grants combine by content tier',async()=>{
 const s=store();await add(s,'existing','aeroastro','read');const auth=asUser(s,'existing');
 assert.equal((await auth({},{scope:'aeroastro'})).role,'read');
 await add(s,'existing','school','read');await add(s,'existing','aeroastro','limited_write');
 assert.equal((await auth({},{scope:'aeroastro',audience:'full'})).role,'read');
 assert.equal((await auth({},{scope:'aeroastro',audience:'limited',minimum:'write'})).role,'limited_write');
 assert.equal((await auth({},{scope:'aeroastro',audience:'full',minimum:'write'})).statusCode,403);
 for(const scope of Object.keys(units.UNITS)){assert.equal(policy.effectiveRole((await policy.loadPolicy(s)).data,'oconaill',scope),'admin');}
});
