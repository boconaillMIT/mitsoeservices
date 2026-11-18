import test from 'node:test';
import assert from 'node:assert/strict';
import units from './src/units.cjs';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createUnitDataHandler,validPayload} from './src/unit-data.mjs';
import {createOtherHandler} from './src/unit-hub.mjs';
const payload=scope=>({schema:1,scope,statement:{id:1,unit:units.WALLETS[scope].source,status:'Verified',cycle:2028},rows:[{statement_id:'1',unit:units.WALLETS[scope].source,cycle:2028}]});
function auth(scope,role){const data=policy.initialPolicy();data.grants.push({username:'testuser',scope,role});return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'testuser'}),load:async()=>({data,etag:'test'})});}
test('all other-unit roles enforce isolation before reading wallet data',async()=>{
 assert.equal(Object.keys(units.OTHER_UNITS).length,22);
 assert.equal(Object.keys(units.WALLETS).length,36);
 for(const scope of Object.keys(units.OTHER_UNITS))for(const role of Object.keys(policy.ROLES)){
  let reads=0;const authorize=auth(scope,role),endpoint=createUnitDataHandler({authorize,read:async requested=>{reads++;return payload(requested);}});
  for(const requested of Object.keys(units.WALLETS)){
   const before=reads,r=await endpoint({httpMethod:'GET',queryStringParameters:{unit:requested}});
   const allowed=requested===scope&&!role.startsWith('limited_');
   assert.equal(r.statusCode,allowed?200:403);assert.equal(reads-before,allowed?1:0);
  }
  const page=createUnitHandler(authorize);
  assert.equal((await page({httpMethod:'GET',path:units.unitPath(scope,'limited')})).statusCode,200);
  const directory=await createOtherHandler(authorize)({httpMethod:'GET'});
  assert.ok(directory.body.includes(units.unitPath(scope,'limited')));
  assert.equal(directory.body.includes(units.unitPath(scope)),!role.startsWith('limited_'));
 }
});
test('school wallet is school-wide only and bound to its own verified statement',async()=>{
 for(const scope of ['be','ctl','school']){
  const r=await createUnitHandler(auth(scope,'read'))({httpMethod:'GET',path:'/soe-wallet'});
  assert.equal(r.statusCode,scope==='school'?200:403);
 }
 assert.equal(validPayload(payload('school'),'school'),true);
 assert.equal(validPayload(payload('be'),'school'),false);
 assert.equal(units.unitRoute({path:'/other-units/be/wallet'}),null);
 assert.equal(units.unitRoute({path:'/units/ctl/wallet'}),null);
 assert.equal(units.unitRoute({path:'/other-units/mit-portugal/wallet'}).scope,'mit-portugal');
 assert.equal(units.unitRoute({queryStringParameters:{unit:'school',section:'limited'}}),null);
});
test('other unit administrators manage only their own unit',()=>{
 const data=policy.initialPolicy();data.grants.push({username:'testuser',scope:'ctl',role:'admin'});
 assert.deepEqual(policy.managedScopes(data,'testuser'),['ctl']);
 assert.equal(policy.effectiveRole(data,'testuser','school'),null);
 assert.equal(policy.effectiveRole(data,'testuser','be'),null);
});
