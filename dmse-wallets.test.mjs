import test from 'node:test';
import assert from 'node:assert/strict';
import units from './src/units.cjs';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createUnitDataHandler,validPayload} from './src/unit-data.mjs';
import {createOtherHandler} from './src/unit-hub.mjs';
function auth(scope,role){const data=policy.initialPolicy();data.grants.push({username:'person',scope,role});return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'person'}),load:async()=>({data,etag:'test'})});}
test('DMSE lists three unlocked wallets and Other units excludes managed programs',async()=>{
 const authorize=auth('school','admin');
 const page=await createUnitHandler(authorize)({httpMethod:'GET',path:'/units/dmse/full'});
 assert.equal(page.statusCode,200);
 for(const name of ['DMSE resource wallet','Archaeology resource wallet','PPSM resource wallet'])assert.ok(page.body.includes(name));
 const other=await createOtherHandler(authorize)({httpMethod:'GET'});
 assert.ok(!other.body.includes('Archaeology'));assert.ok(!other.body.includes('Polymer'));
 assert.ok(!Object.hasOwn(policy.SCOPES,'archaeology'));assert.ok(!Object.hasOwn(policy.SCOPES,'ppst'));
 assert.equal(Object.keys(units.WALLETS).length,36);
});
test('managed routes use DMSE authorization and protect private storage reads',async()=>{
 for(const resource of ['archaeology','ppst']){
  assert.equal(units.permissionScope(resource),'dmse');assert.equal(units.walletBlocked(resource),false);
  for(const [scope,role] of [['dmse','read'],['dmse','admin'],['dmse','limited_read'],['school','admin'],['be','admin'],['ctl','admin']]){
   const authorize=auth(scope,role),requests=[];let reads=0;
   const wrapped=(event,options)=>{requests.push(options);return authorize(event,options);};
   const page=createUnitHandler(wrapped);
   const allowed=['dmse','school'].includes(scope)&&!role.startsWith('limited_');
   for(const path of [units.unitPath(resource,'wallet'),'/other-units/'+resource+'/wallet']){
    assert.equal((await page({httpMethod:'GET',path,queryStringParameters:{unit:'school'}})).statusCode,allowed?200:403);
    assert.equal(requests.at(-1).scope,'dmse');
   }
   const api=createUnitDataHandler({authorize:wrapped,read:async()=>{reads++;return {schema:1,scope:resource,statement:{id:1,unit:units.WALLETS[resource].source,status:'Verified',cycle:2028},rows:[]};}});
   assert.equal((await api({httpMethod:'GET',queryStringParameters:{unit:resource}})).statusCode,allowed?200:403);
   assert.equal(requests.at(-1).scope,'dmse');assert.equal(reads,allowed?1:0);
   const legacy=await page({httpMethod:'GET',path:'/other-units/'+resource+'/full'});
   assert.equal(legacy.statusCode,['dmse','school'].includes(scope)&&!role.startsWith('limited_')?302:403);
   if(legacy.statusCode===302)assert.equal(legacy.headers.Location,'/units/dmse/full');
  }
  const payload={schema:1,scope:resource,statement:{id:1,unit:units.WALLETS[resource].source,status:'Verified',cycle:2028},rows:[]};
  assert.equal(validPayload(payload,resource),true);assert.equal(validPayload(payload,'dmse'),false);
 }
 assert.equal(units.unitRoute({path:'/units/be/wallets/archaeology'}),null);
 assert.equal(units.unitRoute({path:'/units/dmse/wallets/unknown'}),null);
});
