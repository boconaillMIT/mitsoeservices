import test from 'node:test';
import assert from 'node:assert/strict';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import units from './src/units.cjs';
import view from './src/test-view.cjs';
import {createUnitHandler} from './src/unit-page.mjs';
import {createUnitDataHandler,validPayload} from './src/unit-data.mjs';
import {createNimbusDataHandler,validRows} from './src/nimbus-data.mjs';
import {createNimbusPageHandler} from './src/nimbus-page.mjs';
import {unitLanding} from './src/unit-hub.mjs';
import {createTestControlsHandler} from './src/test-controls.mjs';
import {createAdminHandler} from './src/admin-api.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {wallet,accounts,transactions} from './src/fake-unit.mjs';
const cookie=view.COOKIE+'=1',data=policy.initialPolicy();
function auth(login='oconaill',grants=data){return (event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:login}),load:async()=>({data:grants,etag:'test'})});}
const event=(path,params={})=>({httpMethod:'GET',path,headers:{cookie},queryStringParameters:params});
test('DAF test view reduces Brian to SOE Fake and denies every real unit and school scope',async()=>{
 const authorize=auth(),before=JSON.stringify(data);
 const own=await authorize(event('/'),{scope:'soe-fake'});
 assert.equal(own.role,'admin');assert.equal(own.admin,false);assert.equal(own.schoolAccess,false);assert.deepEqual(own.managedScopes,['soe-fake']);assert.equal(own.navigation.other,false);
 for(const scope of Object.keys(policy.SCOPES).filter(s=>s!=='soe-fake'))assert.equal((await authorize(event('/'),{scope})).statusCode,403,scope);
 assert.equal((await authorize({headers:{}},{scope:'school'})).admin,true);
 assert.equal(JSON.stringify(data),before);
 const home=await createDashboardHandler(authorize)(event('/'));assert.equal(home.statusCode,200);assert.match(home.body,/Your units/);
});
test('a forged test flag never grants access and revoked school admin cannot use test view',async()=>{
 for(const login of ['juliekuk','unassigned','unitperson'])assert.equal((await auth(login)(event('/'),{scope:'soe-fake'})).statusCode,403);
 const revoked={...data,grants:[]};assert.equal((await auth('oconaill',revoked)(event('/'),{scope:'soe-fake'})).statusCode,403);
});
test('fictional wallet follows the same unlocked page and data rules as real academic units',async()=>{
 assert.equal(validPayload(wallet(),'soe-fake'),true);assert.equal(validPayload(wallet(),'be'),false);
 assert.ok(units.UNITS['soe-fake'].testOnly);assert.equal(units.walletBlocked('soe-fake'),false);assert.equal(units.walletBlocked('dmse'),false);
 const authorize=auth(),api=createUnitDataHandler({authorize,read:()=>{throw Error('Real storage must not be read');}});
 const result=await api(event('',{unit:'soe-fake'}));assert.equal(result.statusCode,200);
 const page=await createUnitHandler(authorize)(event('/units/soe-fake/wallet'));assert.equal(page.statusCode,200);
 const full=await createUnitHandler(authorize)(event('/units/soe-fake/full'));assert.doesNotMatch(full.body,/soe-fake\/accounts/);assert.doesNotMatch(full.body,/currently blocked/);assert.match(full.body,/href="\/units\/soe-fake\/wallet"/);assert.match(full.body,/Exit DAF test view/);assert.doesNotMatch(full.body,/href="\/soe-hq"/);
});
test('unrun fake Nimbus is empty using the same unit snapshot logic and cannot import live exports',async()=>{
 const authorize=auth(),never=()=>{throw Error('Real data access forbidden');},handler=createNimbusDataHandler({authorize,store:async()=>({get:async key=>{assert.equal(key,'head:soe-fake');return null;}}),repository:never,accounts:never,query:never});
 assert.equal(validRows(transactions,null,100).length,24);
 const status=await handler(event('',{unit:'soe-fake',action:'status'}));assert.equal(JSON.parse(status.body).saved,null);assert.equal(JSON.parse(status.body).legacyAvailable,false);
 const all=await handler(event('',{unit:'soe-fake'}));assert.equal(all.statusCode,200);assert.equal(JSON.parse(all.body).total,0);
 const search=await handler(event('',{unit:'soe-fake',q:'robotics',year:'2026'}));assert.equal(JSON.parse(search.body).total,0);
 assert.equal((await handler(event('',{unit:'soe-fake',source:'legacy'}))).statusCode,403);
 assert.equal((await handler({...event('',{unit:'soe-fake'}),httpMethod:'POST'})).statusCode,403);
 assert.equal((await handler(event('',{unit:'be'}))).statusCode,403);
 assert.equal((await handler(event('',{unit:'school'}))).statusCode,403);
 const page=await createNimbusPageHandler(authorize)(event('/units/soe-fake/nimbus'));assert.equal(page.statusCode,200);assert.match(page.body,/FICTIONAL TEST DATA/);assert.match(page.body,/id="nimbus-refresh"/);
});
test('fake full and limited pages use exactly the same resource sections and controls as real units',async()=>{
 const sections=html=>[...html.matchAll(/<h[23][^>]*>(.*?)<\/h[23]>/g)].map(m=>m[1].replaceAll('SOE Fake','UNIT').replaceAll('AeroAstro','UNIT'));
 const controls=html=>[...html.matchAll(/<(?:input|select|button)[^>]*>/g)].map(m=>m[0]);
 for(const section of ['full','limited']){
  const fake=unitLanding('soe-fake',section,true,'',false,false,{},true,true),real=unitLanding('aeroastro',section,true,'',false,false,{},true,true);
  assert.deepEqual(sections(fake),sections(real));assert.deepEqual(controls(fake),controls(real));
 }
 assert.equal((await createUnitHandler(auth())(event('/units/soe-fake/accounts'))).statusCode,404);
 for(const a of accounts)assert.equal(a.after,a.balance-a.commitments-a.estimate);
});

test('test controls require Brian and same-origin POST; GET never changes the view',async()=>{
 const saved=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
 try{
  const controls=createTestControlsHandler(auth()),get=await controls(event('/testing/soe-fake'));assert.equal(get.statusCode,200);assert.equal(get.headers['Set-Cookie'],undefined);
  const post={...event('/testing/soe-fake'),httpMethod:'POST',body:'action=enter',headers:{origin:process.env.APP_ORIGIN,'content-type':'application/x-www-form-urlencoded'}};
  const entered=await controls(post);assert.equal(entered.statusCode,303);assert.match(entered.headers['Set-Cookie'],/Secure; HttpOnly; SameSite=Strict; Max-Age=3600/);
  assert.equal((await controls({...post,headers:{...post.headers,origin:'https://evil.example'}})).statusCode,403);
  assert.equal((await createTestControlsHandler(auth('juliekuk'))({...post,headers:{...post.headers}})).statusCode,403);
  const exited=await controls({...post,body:'action=exit',headers:{...post.headers,cookie}});assert.match(exited.headers['Set-Cookie'],/Max-Age=0/);
 }finally{if(saved===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=saved;}
});
test('test-view administration cannot mutate real-unit policy even with a forged scope',async()=>{
 const saved=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';let changes=0;
 try{
  const handler=createAdminHandler({authorize:auth(),change:async()=>{changes++;throw Error('Must not mutate');}});
  const get=await handler(new Request(process.env.APP_ORIGIN+'/admin',{headers:{cookie}})),body=await get.json();assert.deepEqual(Object.keys(body.scopes),['soe-fake']);assert.ok(body.grants.every(g=>g.scope==='soe-fake'));
  for(const scope of ['school','aeroastro','be']){
   const r=await handler(new Request(process.env.APP_ORIGIN+'/admin',{method:'POST',headers:{cookie,origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({action:'add',scope,username:'person',role:'admin',version:'test'})}));assert.equal(r.status,403);
  }
  assert.equal(changes,0);
 }finally{if(saved===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=saved;}
});
