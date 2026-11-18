import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnitHandler} from './src/unit-page.mjs';
import {createUnitDataHandler} from './src/unit-data.mjs';
import units from './src/units.cjs';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
function auth(scope,role){const data=policy.initialPolicy();data.grants.push({username:'person',scope,role});return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'person'}),load:async()=>({data,etag:'test'})});}
test('unlocked academic wallets retain per-unit authorization for pages and data',async()=>{
 for(const unit of Object.keys(units.UNITS))for(const [scope,role]of [[unit,'read'],[unit,'admin'],['school','admin']]){
  const authorize=auth(scope,role),page=createUnitHandler(authorize);let reads=0;
  const full=await page({httpMethod:'GET',path:'/units/'+unit+'/full'});assert.equal(full.statusCode,200);assert.ok(!full.body.includes('currently blocked'));assert.ok(full.body.includes('href="/units/'+unit+'/wallet"'));assert.ok(full.body.includes('Who can view this page'));
  assert.equal((await page({httpMethod:'GET',path:'/units/'+unit+'/wallet'})).statusCode,200);
  const api=createUnitDataHandler({authorize,read:async()=>{reads++;return {schema:1,scope:unit,statement:{id:1,unit:units.WALLETS[unit].source,status:'Verified',cycle:2028},rows:[]};}});assert.equal((await api({httpMethod:'GET',queryStringParameters:{unit}})).statusCode,200);assert.equal(reads,unit==='soe-fake'?0:1);
 }
 assert.equal(units.walletBlocked('school'),false);for(const scope of Object.keys(units.OTHER_UNITS))assert.equal(units.walletBlocked(scope),false);
});
