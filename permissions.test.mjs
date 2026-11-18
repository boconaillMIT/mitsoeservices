import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
function store(initial=null){let data=initial,version=0;return {async getWithMetadata(){return data?{data:structuredClone(data),etag:String(version)}:null;},async setJSON(k,value,c={}){if(c.onlyIfNew&&data||c.onlyIfMatch&&c.onlyIfMatch!==String(version))return {modified:false};data=structuredClone(value);version++;return {modified:true};}};}
async function grant(s,username,scope,role){const state=await policy.loadPolicy(s);return policy.changePolicy('oconaill','add',username,state.etag,s,{scope,role});}
function asUser(s,username){return (event,options={})=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:username}),load:()=>policy.loadPolicy(s)});}
test('fresh pilot and legacy migration authorize only Brian and Julie',async()=>{
 for(const initial of [null,{users:['oconaill','juliekuk','hammond','kimcs','afahim'],audit:[]}]){
  const s=store(initial);const state=await policy.loadPolicy(s);
  assert.deepEqual([...state.data.users].sort(),['juliekuk','oconaill']);
  assert.ok(state.data.grants.every(g=>g.scope==='school'&&g.role==='admin'));
  assert.equal((await asUser(s,'hammond')({})).statusCode,403);
 }
});
test('NSE read-only grant cannot see BE, school reports, or write',async()=>{
 const s=store();await grant(s,'test_nse','nse','read');const auth=asUser(s,'test_nse');
 assert.equal((await auth({},{scope:'nse'})).role,'read');
 for(const options of [{scope:'be'},{scope:'school'},{scope:'nse',minimum:'write'},{scope:'nse',minimum:'admin'},{scope:'unknown'}])assert.equal((await auth({},options)).statusCode,403);
 const handler=createUnitHandler(auth);
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'be'}})).statusCode,403);
 const nse=await handler({httpMethod:'GET',queryStringParameters:{unit:'nse'}});
 assert.equal(nse.statusCode,200);assert.ok(nse.body.includes('NSE Full access'));assert.ok(!nse.body.includes('BE Full access'));
 assert.equal((await handler({httpMethod:'GET',path:'/units/nse',queryStringParameters:{}})).statusCode,200);
 assert.equal((await handler({httpMethod:'GET',path:'/units/be',queryStringParameters:{unit:'nse'}})).statusCode,403);
});
test('global roles propagate; unit write is confined and cannot manage access',async()=>{
 const s=store();await grant(s,'test_school','school','read');await grant(s,'test_be','be','write');
 for(const scope of ['school','nse','be'])assert.equal((await asUser(s,'test_school')({},{scope})).role,'read');
 assert.equal((await asUser(s,'test_be')({},{scope:'be',minimum:'write'})).canWrite,true);
 assert.equal((await asUser(s,'test_be')({},{scope:'nse'})).statusCode,403);
 const current=await policy.loadPolicy(s);assert.equal((await policy.changePolicy('test_be','add','another',current.etag,s)).status,403);
 assert.equal((await grant(s,'unit_admin','be','admin')).status,200);
 for(const username of policy.ADMINS)assert.equal(policy.effectiveRole(current.data,username,'be'),'admin');
 assert.equal((await policy.changePolicy('juliekuk','remove','oconaill',current.etag,s)).status,400);
});
test('revocation and downgrades apply to already signed-in users',async()=>{
 const s=store();await grant(s,'test_nse','nse','write');const auth=asUser(s,'test_nse');
 assert.ok((await auth({},{scope:'nse',minimum:'write'})).user);
 await grant(s,'test_nse','nse','read');assert.equal((await auth({},{scope:'nse',minimum:'write'})).statusCode,403);
 const current=await policy.loadPolicy(s);await policy.changePolicy('juliekuk','remove','test_nse',current.etag,s,{scope:'nse'});
 assert.equal((await auth({},{scope:'nse'})).statusCode,403);
});
test('direct wallet endpoint fails closed for anonymous, invalid units and unsupported methods',async()=>{
 const handler=createUnitHandler(async()=>({statusCode:401}));
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'nse'}})).statusCode,302);
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'../be'}})).statusCode,404);
 assert.equal((await handler({httpMethod:'POST',queryStringParameters:{unit:'nse'}})).statusCode,405);
});
test('Julie can be managed like another user, while Brian remains a recovery administrator',async()=>{
 const s=store();let current=await policy.loadPolicy(s);
 assert.equal((await policy.changePolicy('oconaill','add',' JULIEKUK@MIT.EDU ',current.etag,s,{role:'read'})).status,200);
 assert.equal((await asUser(s,'juliekuk')({})).admin,false);
 current=await policy.loadPolicy(s);
 assert.equal((await policy.changePolicy('juliekuk','add','someone',current.etag,s)).status,403);
 assert.equal((await policy.changePolicy('oconaill','add','juliekuk',current.etag,s,{role:'admin'})).status,200);
 assert.equal((await asUser(s,'JulieKuk@mit.edu')({})).admin,true);
 current=await policy.loadPolicy(s);
 assert.equal((await policy.changePolicy('oconaill','remove','juliekuk',current.etag,s)).status,200);
 assert.equal((await asUser(s,'juliekuk')({})).statusCode,403);
 current=await policy.loadPolicy(s);
 assert.equal((await policy.changePolicy('oconaill','remove','oconaill@mit.edu',current.etag,s)).status,400);
});
test('MIT login normalization does not trust other domains or an email fallback',async()=>{
 assert.equal(policy.normalizeLogin(' JulieKuk@MIT.EDU '),'juliekuk');
 for(const input of ['juliekuk@example.org','juliekuk@mit.edu.evil.org','x<script>','juliekuk@mit.edu@mit.edu',''])assert.equal(policy.normalizeLogin(input),null);
 const s=store();
 const denied=await access.authorize({},{loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'notgranted',email:'juliekuk@mit.edu'}),load:()=>policy.loadPolicy(s)});
 assert.equal(denied.statusCode,403);assert.ok(denied.body.includes('Signed-in login: notgranted'));assert.ok(!denied.body.includes('juliekuk'));
});
