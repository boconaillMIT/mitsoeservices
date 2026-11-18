import test from 'node:test';
import assert from 'node:assert/strict';
import units from './src/units.cjs';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createUnitDataHandler,validPayload} from './src/unit-data.mjs';
const payload=scope=>({schema:1,scope,statement:{id:1,unit:units.WALLETS[scope].source,status:'Verified',cycle:2028},controls:{},rows:[{statement_id:'1',unit:units.WALLETS[scope].source,cycle:2028}]});
function authFor(scope,role='read'){
 const state=policy.initialPolicy();state.grants.push({username:'test_unit',scope,role});
 return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'test_unit'}),load:async()=>({data:state,etag:'test'})});
}
test('all academic wallet endpoints allow their own Full Access users and deny other units',async()=>{
 assert.equal(Object.keys(units.UNITS).length,11);
 for(const granted of Object.keys(units.UNITS)){
  let reads=0;const authorize=authFor(granted);
  const endpoint=createUnitDataHandler({authorize,read:async scope=>{reads++;return payload(scope);}});
  const page=createUnitHandler(authorize);
  for(const requested of Object.keys(units.UNITS)){
   const event={httpMethod:'GET',queryStringParameters:{unit:requested}};
   const before=reads;const response=await endpoint(event);
   assert.equal(response.statusCode,granted===requested?200:403);
   assert.equal(reads-before,response.statusCode===200&&requested!=='soe-fake'?1:0,'denied users must never trigger a data read');
   assert.equal((await page({...event,path:'/units/'+requested})).statusCode,granted===requested?200:403);
   if(response.statusCode===200)assert.equal(JSON.parse(response.body).scope,granted);
  }
 }
});
test('anonymous direct data URLs do not access storage',async()=>{
 let reads=0;const handler=createUnitDataHandler({authorize:async()=>({statusCode:401,body:'Sign in'}),read:async()=>{reads++;}});
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'be'}})).statusCode,401);assert.equal(reads,0);
 assert.equal((await handler({httpMethod:'POST',queryStringParameters:{unit:'be'}})).statusCode,405);
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'../be'}})).statusCode,404);
});
test('wrong-unit and mixed-unit snapshots fail closed without data in error responses',async()=>{
 for(const data of [payload('sdm'),{...payload('ctl'),rows:[...payload('ctl').rows,...payload('sdm').rows]}]){
  assert.equal(validPayload(data,'ctl'),false);
  const handler=createUnitDataHandler({authorize:authFor('ctl'),read:async()=>data});
  const r=await handler({httpMethod:'GET',queryStringParameters:{unit:'ctl'}});assert.equal(r.statusCode,503);assert.ok(!r.body.includes('Nuclear'));
 }
 const handler=createUnitDataHandler({authorize:authFor('ctl'),read:async()=>{throw Error('upstream confidential detail');}});
 assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'ctl'}})).body,'Wallet data is temporarily unavailable.');
});
test('production and preview wallet stores have separate deployment contexts',async()=>{
 assert.equal(policy.deploymentName(),'preview');
 await policy.withPolicyContext({deploy:{published:true}},async()=>{assert.equal(policy.deploymentName(),'production');});
 await policy.withPolicyContext({deploy:{published:false}},async()=>{assert.equal(policy.deploymentName(),'preview');});
});
