import test from 'node:test';
import assert from 'node:assert/strict';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import {createWorkerPilotHandler} from './src/worker-pilot.mjs';
const copy=x=>x===undefined?undefined:structuredClone(x);
function fixture(){const records=new Map();let revision=0;const data=policy.initialPolicy();data.grants.push({username:'unitadmin',scope:'aeroastro',role:'admin'});const store={async get(k){return copy(records.get(k)?.data)||null;},async getWithMetadata(k){return copy(records.get(k))||null;},async setJSON(k,value,options={}){const old=records.get(k);if(options.onlyIfNew&&old||options.onlyIfMatch&&options.onlyIfMatch!==old?.etag)return {modified:false};records.set(k,{data:copy(value),etag:String(++revision)});return {modified:true};}};const handler=user=>createWorkerPilotHandler({authorize:(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'policy'})}),store:async()=>store,loadPolicy:async()=>({data}),now:()=>new Date('2026-10-26T15:00:00Z')});return {data,records,handler};}
const req=(body,headers={})=>({httpMethod:'POST',headers:{origin:'https://mitsoeservices.netlify.app','content-type':'application/json',...headers},body:JSON.stringify(body)});
const report={view:'all',period:'202704',retrieved:'2026-10-26T14:00:00Z',rows:[{key:'1234567',name:'Pilot',deans_discretionary:false,balance:'100',projected:'10',estimate:'5',actual:'0',after:'85'}]};
process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
test('only Brian can create worker tokens or read pilot reports',async()=>{
 const f=fixture();for(const user of ['juliekuk','unitadmin',null]){assert.equal((await f.handler(user)(req({action:'create'}))).statusCode,user?403:401);assert.equal((await f.handler(user)({httpMethod:'GET',headers:{}})).statusCode,user?403:401);}assert.equal(f.records.size,0);
});
test('device token is upload-only, hashed at rest, and never replaces the shared report',async()=>{
 const f=fixture(),created=await f.handler('oconaill')(req({action:'create',label:'Test PC'}));assert.equal(created.statusCode,200);const token=JSON.parse(created.body).token;assert.ok(!JSON.stringify([...f.records.values()]).includes(token));
 const device=f.handler(null),uploaded=await device(req(report,{authorization:'Bearer '+token}));assert.equal(uploaded.statusCode,200);assert.equal(f.records.get('latest:oconaill').data.result.rows[0].balance,'100');assert.ok(!f.records.has('latest'));
 const listing=await f.handler('oconaill')({httpMethod:'GET',headers:{}});assert.ok(!listing.body.includes(token));assert.ok(!listing.body.includes('"hash"'));
 assert.equal((await device({httpMethod:'GET',headers:{authorization:'Bearer '+token}})).statusCode,403);
 assert.equal((await device(req({...report,scope:'aeroastro'},{authorization:'Bearer '+token}))).statusCode,409);
});
test('revocation, expiry, forged tokens, and removed administrator permission block uploads',async()=>{
 for(const condition of ['revoked','expired','forged','permission']){const f=fixture();let token=JSON.parse((await f.handler('oconaill')(req({action:'create'}))).body).token;const key='device:'+token.split('.')[0],record=f.records.get(key).data;
  if(condition==='revoked')record.revoked=true;if(condition==='expired')record.expires_at='2026-10-25T00:00:00Z';if(condition==='forged')token=token.slice(0,-1)+(token.endsWith('a')?'b':'a');if(condition==='permission')f.data.grants=f.data.grants.filter(g=>g.username!=='oconaill');
  assert.equal((await f.handler(null)(req(report,{authorization:'Bearer '+token}))).statusCode,403);assert.ok(!f.records.has('latest:oconaill'));
 }
});
test('origin checks and report validation prevent unauthorized setup or malformed publication',async()=>{
 const f=fixture();assert.equal((await f.handler('oconaill')(req({action:'create'},{origin:'https://evil.example'}))).statusCode,403);
 const token=JSON.parse((await f.handler('oconaill')(req({action:'create'}))).body).token;
 assert.equal((await f.handler(null)(req({view:'all',rows:[]},{authorization:'Bearer '+token}))).statusCode,400);assert.ok(!f.records.has('latest:oconaill'));
});
