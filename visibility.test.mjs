import test from 'node:test';import assert from 'node:assert/strict';import access from './src/access.cjs';import policy from './src/policy.cjs';import flags from './src/features.cjs';import {createVisibilityHandler} from './src/visibility.mjs';import {createUnitHandler} from './src/unit-page.mjs';
const origin='https://mitsoeservices.netlify.app';process.env.APP_ORIGIN=origin;
function fixture(){let value=null,version=0;const data=policy.initialPolicy();data.grants.push({username:'daf',scope:'aeroastro',role:'admin'},{username:'reader',scope:'aeroastro',role:'read'},{username:'limited',scope:'aeroastro',role:'limited_read'});const s={async getWithMetadata(){return value?{data:structuredClone(value),etag:String(version)}:null;},async setJSON(k,v,c){if(c.onlyIfNew&&value||c.onlyIfMatch&&c.onlyIfMatch!==String(version))return {modified:false};value=structuredClone(v);version++;return {modified:true};}};const auth=user=>(event,options)=>access.authorize(event,{...options,reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'access'}),loadFeatures:options?.loadFeatures||(()=>flags.loadFlags(s))});return {s,auth,handler:user=>createVisibilityHandler({authorize:auth(user),store:async()=>s})};}
const event=(path,params={})=>({httpMethod:'GET',path,queryStringParameters:params});
const change=(target,changes,version=null)=>({httpMethod:'POST',path:'/.netlify/functions/visibility',headers:{origin,'content-type':'application/json'},body:JSON.stringify({target,changes,version})});
test('visibility is SoE-admin-only and does not grant a unit admin policy control',async()=>{
 const f=fixture();for(const user of ['daf','reader','limited'])assert.equal((await f.handler(user)(event('/settings/visibility'))).statusCode,403);assert.equal((await f.handler(null)(event('/settings/visibility'))).statusCode,302);assert.equal((await f.handler('oconaill')(event('/settings/visibility'))).statusCode,200);
});
test('unit-only switches hide links, direct pages and function endpoints while retaining SoE visibility',async()=>{
 const f=fixture(),saved=await f.handler('oconaill')(change('units',{wallets:false,nimbus:false,'account-inventory':false,allocations:false}));assert.equal(saved.statusCode,200);
 for(const [path,q]of [['/units/aeroastro/wallet',{}],['/.netlify/functions/unit-data',{unit:'aeroastro'}],['/.netlify/functions/unit-page',{unit:'aeroastro',section:'wallet'}],['/units/aeroastro/nimbus',{}],['/.netlify/functions/nimbus-data',{unit:'aeroastro'}],['/units/aeroastro/account-list',{}],['/.netlify/functions/account-inventory',{unit:'aeroastro'}],['/worker-pilot',{report:'account-inventory'}],['/.netlify/functions/worker-pilot',{action:'tabular',report:'account-inventory'}],['/units/aeroastro/allocations',{}],['/.netlify/functions/unit-allocations',{unit:'aeroastro'}]]){
  assert.equal((await f.auth('daf')(event(path,q),{scope:'aeroastro'})).statusCode,403,path);assert.equal((await f.auth('oconaill')(event(path,q),{scope:'aeroastro'})).role,'admin');
 }
 const page=await createUnitHandler(f.auth('daf'))(event('/units/aeroastro/full'));assert.equal(page.statusCode,200);for(const text of ['href="/units/aeroastro/wallet"','Nimbus Search','account-list','id="unit-allocations"'])assert.ok(!page.body.includes(text),text);
 const globals=JSON.parse(saved.body).policy;assert.equal(globals.features.wallets.school,true);assert.equal(globals.features.wallets.units,false);
});
test('universal switches affect SoE roles, version conflicts reject stale changes and recovery controls remain accessible',async()=>{
 const f=fixture(),first=await f.handler('oconaill')(change('everyone',{wallets:false}));assert.equal(first.statusCode,200);assert.equal((await f.auth('oconaill')(event('/soe-wallet'),{scope:'school'})).statusCode,403);
 assert.equal((await f.handler('oconaill')(event('/settings/visibility'))).statusCode,200);assert.equal((await f.handler('oconaill')(change('units',{wallets:true}))).statusCode,409);
 const version=JSON.parse(first.body).version;assert.equal((await f.handler('oconaill')(change('everyone',{wallets:true},version))).statusCode,200);assert.equal((await f.auth('oconaill')(event('/soe-wallet'),{scope:'school'})).role,'admin');
});
test('visibility storage failure denies protected resources; unapproved grants remain denied even when visible',async()=>{
 const f=fixture();const failed=await access.authorize(event('/units/aeroastro/wallet'),{scope:'aeroastro',reader:async()=>({kerberos:'daf'}),load:async()=>({data:{grants:[{username:'daf',scope:'aeroastro',role:'read'}]},etag:'p'}),loadFeatures:async()=>{throw Error('private storage detail');}});assert.equal(failed.statusCode,503);assert.ok(!failed.body.includes('private storage detail'));
 assert.equal((await f.auth('limited')(event('/units/aeroastro/wallet'),{scope:'aeroastro'})).statusCode,403);
 const foreign=change('everyone',{wallets:false});foreign.headers.origin='https://evil.example';assert.equal((await f.handler('oconaill')(foreign)).statusCode,403);
});
