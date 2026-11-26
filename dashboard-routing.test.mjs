import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardHandler} from './src/dashboard.mjs';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
function home(grants){const data=policy.initialPolicy();data.grants.push(...grants.map(([scope,role])=>({username:'testuser',scope,role})));return createDashboardHandler((event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'testuser'}),load:async()=>({data,etag:'test'})}))({httpMethod:'GET'});}
test('single-unit Home shows only its permitted Full and Limited links',async()=>{
 for(const role of Object.keys(policy.ROLES)){
  const result=await home([['aeroastro',role]]);
  assert.equal(result.statusCode,200);
  assert.ok(result.body.includes('/units/aeroastro/limited'));assert.equal(result.body.includes('/units/aeroastro/full'),!role.startsWith('limited_'));assert.ok(!result.body.includes('href="/academic-units"'));
  assert.match(result.headers['Cache-Control'],/no-store/);
 }
 const other=await home([['ctl','admin']]);assert.ok(other.body.includes('/other-units/ctl/full'));
});
test('multiple-unit and school users keep Home; unapproved users cannot redirect into a unit',async()=>{
 for(const grants of [[['aeroastro','read'],['be','limited_read']],[['school','admin']],[['school','limited_read']]]){
  const result=await home(grants);assert.equal(result.statusCode,200);assert.equal(result.headers.Location,undefined);
 }
 const requester=await home([]);assert.equal(requester.statusCode,200);assert(requester.body.includes('/donation-requests'));for(const path of ['href="/soe-hq"','href="/units/','href="/soe-hq/rct-review"'])assert(!requester.body.includes(path));
});

test('one to three units share a combined landing page across academic and other units; four retain directories',async()=>{
 const small=await home([['aeroastro','admin'],['be','limited_read'],['ctl','read']]);assert.equal(small.statusCode,200);assert.match(small.body,/Your units/);
 for(const href of ['/units/aeroastro/full','/units/aeroastro/limited','/units/be/limited','/other-units/ctl/full','/other-units/ctl/limited'])assert.ok(small.body.includes(href));
 for(const href of ['/units/be/full','/units/nse/full','href="/academic-units"','href="/other-units"'])assert.ok(!small.body.includes(href));
 const four=await home([['aeroastro','read'],['be','limited_read'],['ctl','read'],['nse','read']]);assert.ok(four.body.includes('href="/academic-units"'));assert.ok(four.body.includes('href="/other-units"'));
});
