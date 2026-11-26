import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMyUnitHandler} from './src/my-unit.mjs';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import units from './src/units.cjs';
import sso from './src/mit-sso.cjs';

function fixture(grants,username='testuser'){
 const data=policy.initialPolicy();
 data.grants.push(...grants.map(([scope,role])=>({username,scope,role})));
 const handler=createMyUnitHandler((event,options)=>access.authorize(event,{...options,reader:async()=>username?{kerberos:username}:null,load:async()=>({data,etag:'test'}),loadFeatures:async()=>({data:{features:{}}})}));
 return {data,handler};
}
const event={httpMethod:'GET',path:'/my-unit'};
test('MIT sign-in accepts the smart link as its return destination',()=>{
 assert.equal(sso.safeReturnTo('/my-unit','https://mitsoeservices.netlify.app'),'/my-unit');
});
test('each unit and role redirects only to its authorized Full or Limited page',async()=>{
 for(const scope of Object.keys(units.ALL_UNITS))for(const role of Object.keys(policy.ROLES)){
  const {handler}=fixture([[scope,role]]),r=await handler(event);
  assert.equal(r.statusCode,302);assert.equal(r.headers.Location,units.unitPath(scope,role.startsWith('limited_')?'limited':'full'));
  assert.match(r.headers['Cache-Control'],/private, no-store/);assert.equal(r.headers.Vary,'Cookie');
 }
});
test('BE and NSE examples, and duplicate Full/Limited grants, choose the right unit',async()=>{
 for(const [unit,expected]of [['be','/units/be/full'],['nse','/units/nse/full']]){
  const {handler}=fixture([[unit,'limited_read'],[unit,'admin']]);assert.equal((await handler(event)).headers.Location,expected);
 }
});
test('school-wide users go to Services Home at every role level',async()=>{
 for(const role of Object.keys(policy.ROLES)){const {handler}=fixture([['school',role],['be','read']]);assert.equal((await handler(event)).headers.Location,'/?home=1');}
});
test('multiple-unit users see precisely their authorized unit links, including four or more units',async()=>{
 for(const grants of [[['be','read'],['nse','limited_read']],[['be','read'],['nse','limited_read'],['ctl','write'],['dmse','admin']]]){
  const r=await fixture(grants).handler(event);assert.equal(r.statusCode,200);assert.match(r.body,/Your units/);assert(!r.body.includes('/units/aeroastro/'));assert(!r.body.includes('href="/soe-hq"'));
  for(const [unit,role]of grants){assert(r.body.includes(units.unitPath(unit,'limited')));assert.equal(r.body.includes(units.unitPath(unit,'full')),!role.startsWith('limited_'));}
 }
});
test('unsigned and unauthorized users cannot obtain any unit route',async()=>{
 const unsigned=await fixture([],null).handler(event);assert.equal(unsigned.statusCode,302);assert.equal(unsigned.headers.Location,'/.netlify/functions/auth-login?returnTo=%2Fmy-unit');
 assert.equal((await fixture([]).handler(event)).headers.Location,'/donation-requests');
 const failed=createMyUnitHandler(async()=>({statusCode:503,body:'Policy unavailable.'}));assert.equal((await failed(event)).statusCode,503);
});
test('targets are recomputed from live grants and URL parameters cannot select another unit',async()=>{
 const {handler,data}=fixture([['be','read']]);assert.equal((await handler({...event,queryStringParameters:{unit:'nse',returnTo:'https://example.com'}})).headers.Location,'/units/be/full');
 data.grants=data.grants.filter(g=>g.username!=='testuser');data.grants.push({username:'testuser',scope:'nse',role:'limited_read'});assert.equal((await handler(event)).headers.Location,'/units/nse/limited');
 data.grants=data.grants.filter(g=>g.username!=='testuser');assert.equal((await handler(event)).headers.Location,'/donation-requests');
});
test('DAF test view keeps the school admin restricted to SOE Fake',async()=>{
 const {handler}=fixture([],'oconaill');const r=await handler({...event,headers:{cookie:'__Host-soe_fake_daf_view=1'}});assert.equal(r.headers.Location,'/units/soe-fake/full');
 assert.equal((await fixture([['be','admin']]).handler({...event,headers:{cookie:'__Host-soe_fake_daf_view=1'}})).statusCode,403);
});
test('POST is not accepted and both slash variants have explicit function rewrites',async()=>{
 assert.equal((await fixture([['be','admin']]).handler({...event,httpMethod:'POST'})).statusCode,405);
 const config=(await readFile(new URL('./netlify.toml',import.meta.url),'utf8')).replaceAll('\r\n','\n');for(const path of ['/my-unit','/my-unit/'])assert(config.includes('from = "'+path+'"\n  to = "/.netlify/functions/my-unit"'));
});
