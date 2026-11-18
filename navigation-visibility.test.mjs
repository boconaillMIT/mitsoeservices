import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createOtherHandler} from './src/unit-hub.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {mainNavigation} from './src/navigation.cjs';
function auth(grants){const data=policy.initialPolicy();data.grants.push(...grants.map(([scope,role])=>({username:'person',scope,role})));return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'person'}),load:async()=>({data,etag:'p'})});}
test('AeroAstro-only roles never get Other units or SoE HQ links or directory access',async()=>{
 for(const role of ['limited_read','limited_write','read','write','admin']){const authorize=auth([['aeroastro',role]]),section=role.startsWith('limited_')?'limited':'full';const page=await createUnitHandler(authorize)({httpMethod:'GET',path:'/units/aeroastro/'+section});assert.equal(page.statusCode,200);for(const href of ['/other-units','/soe-hq','/settings','/nimbus'])assert.ok(!page.body.includes('href="'+href+'"'));
 const home=await createDashboardHandler(authorize)({httpMethod:'GET',queryStringParameters:{home:'1'}});assert.equal(home.statusCode,200);assert.ok(!home.body.includes('<h2>Other units</h2>'));assert.ok(!home.body.includes('<h2>SoE HQ</h2>'));assert.equal((await createOtherHandler(authorize)({httpMethod:'GET'})).statusCode,403);}
});
test('explicit Other-unit grants show their directory while HQ requires school-full access',async()=>{
 const other=await auth([['aeroastro','admin'],['ctl','read']])({},{scope:'any',audience:'limited'});const nav=mainNavigation({manage:other.canManage,schoolAccess:other.schoolAccess,visibility:other.navigation});assert.ok(!nav.includes('href="/other-units"'));assert.ok(!nav.includes('href="/soe-hq"'));
 for(const role of ['limited_read','limited_write','read','write','admin']){const r=await auth([['school',role]])({},{scope:'any',audience:'limited'});const html=mainNavigation({manage:r.canManage,schoolAdmin:r.admin,schoolAccess:r.schoolAccess,visibility:r.navigation});assert.equal(html.includes('href="/soe-hq"'),!role.startsWith('limited_'));if(role==='admin')assert.ok(html.includes('Nimbus Search (under construction)'));}
});
