import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import access from './src/access.cjs';import policy from './src/policy.cjs';
import {createSecurityReviewHandler,reviewAccess} from './src/security-review.mjs';
import {createUnitFilesHandler,readFileReview} from './src/unit-files.mjs';
const event=(scope='all')=>({httpMethod:'GET',path:'/.netlify/functions/security-review',queryStringParameters:{scope}});
const data=()=>{const d=policy.initialPolicy();d.grants.push({username:'daf',scope:'aeroastro',role:'admin'},{username:'junior',scope:'aeroastro',role:'limited_read'},{username:'dual',scope:'school',role:'limited_write'},{username:'dual',scope:'aeroastro',role:'read'},{username:'other',scope:'be',role:'admin'});return d;};
const auth=(login,d=data())=>(e,o)=>access.authorize(e,{...o,reader:async()=>login?{kerberos:login}:null,load:async()=>({data:d,etag:'1'}),loadFeatures:async()=>({data:{features:{}}})});
test('security page and API deny every non-school-admin before reading any metadata',async()=>{
 for(const login of [null,'daf','junior','dual','other']){let reads=0;const h=createSecurityReviewHandler({authorize:auth(login),files:async()=>{reads++;return [];},visibility:async()=>{reads++;return {data:{audit:[]}};}});
  assert.equal((await h(event())).statusCode,login?403:401);assert.equal((await h({...event(),path:'/settings/security-review'})).statusCode,login?403:302);assert.equal(reads,0);
 }
});
test('unit review calculates effective full and limited access, including school inheritance',()=>{
 const rows=reviewAccess(data(),'aeroastro');assert(!rows.some(r=>r.username==='other'));assert.equal(rows.find(r=>r.username==='junior').full,'No access');assert.equal(rows.find(r=>r.username==='dual').full,'Read-only (unit-wide)');assert.equal(rows.find(r=>r.username==='dual').limited,'Write (limited)');assert(rows.find(r=>r.username==='oconaill').inherited);
});
test('school review is read-only, scoped, uncached and fails closed on incomplete file verification',async()=>{
 const d=data();d.audit=[{actor:'oconaill',username:'daf',scope:'aeroastro',action:'add',role:'admin',at:'2026-10-28T12:00:00Z'},{actor:'oconaill',username:'other',scope:'be',action:'add',role:'admin',at:'2026-10-28T12:00:00Z'}];let reads=0;
 const h=createSecurityReviewHandler({authorize:auth('oconaill',d),files:async options=>{reads++;assert.deepEqual(options.scopes,['aeroastro']);return [];},visibility:async()=>({data:{audit:[]}})});
 const r=await h(event('aeroastro'));assert.equal(r.statusCode,200);assert.match(r.headers['Cache-Control'],/no-store/);const body=JSON.parse(r.body);assert.equal(body.permissions.length,1);assert(!body.access.some(a=>a.username==='other'));
 assert.equal((await h(event('../be'))).statusCode,400);assert.equal((await h({...event(),httpMethod:'POST'})).statusCode,405);assert.equal(reads,1);
 const failed=createSecurityReviewHandler({authorize:auth('oconaill'),files:async()=>{throw Error('bad signature');},visibility:async()=>({data:{audit:[]}})});assert.equal((await failed(event())).statusCode,503);
});
test('restricted DAF test view cannot expose the security dashboard through the real administrator',async()=>{
 const h=createSecurityReviewHandler({authorize:async()=>({user:{},admin:true,testView:true}),files:async()=>{throw Error('Must not read.');}});assert.equal((await h(event())).statusCode,403);
});
test('security dashboard navigation respects resources hidden for school roles',async()=>{
 const authorize=(e,o)=>access.authorize(e,{reader:async()=>({kerberos:'oconaill'}),load:async()=>({data:data(),etag:'1'}),loadFeatures:async()=>({data:{features:{nimbus:{school:false,units:false}}}}),...o});
 const h=createSecurityReviewHandler({authorize});const r=await h({...event(),path:'/settings/security-review'});assert.equal(r.statusCode,200);assert(!r.body.includes('Nimbus Search'));assert(r.body.includes('Security review'));
});
test('metadata review preserves upload attribution and move history without reading file content or writing storage',async()=>{
 const entries=new Map(),key=randomBytes(32);let version=0,writes=0,contentReads=0;
 const s={async getWithMetadata(k){return structuredClone(entries.get(k))||null;},async get(k){contentReads++;return entries.get(k)?.data;},async set(k,v,c={}){const old=entries.get(k);if(c.onlyIfNew&&old||c.onlyIfMatch&&c.onlyIfMatch!==old?.etag)return {modified:false};writes++;entries.set(k,{data:structuredClone(v),etag:String(++version)});return {modified:true};},async setJSON(k,v,c){return this.set(k,v,c);}};
 process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
 const h=createUnitFilesHandler({authorize:auth('daf'),store:async()=>s,key:()=>key});
 const upload={httpMethod:'POST',queryStringParameters:{unit:'aeroastro',audience:'full'},headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({filename:'Fictional.txt',content:Buffer.from('private body').toString('base64')})};
 const added=JSON.parse((await h(upload)).body).file;const moved=await h({...upload,body:JSON.stringify({action:'move',id:added.id,version:added.id,to:'limited'})});assert.equal(moved.statusCode,200);
 const oldWrites=writes,oldReads=contentReads;const files=await readFileReview({store:async()=>s,key:()=>key,scopes:['aeroastro']});assert.equal(writes,oldWrites);assert.equal(contentReads,oldReads);assert.equal(files[0].uploaded_by,'daf');assert.equal(files[0].changes[0].from,'full');assert.equal(files[0].audience,'limited');assert(!JSON.stringify(files).includes('private body'));assert(!Object.hasOwn(files[0],'storage_key'));
 entries.get('index:aeroastro').data.files[0].filename='Tampered.txt';await assert.rejects(()=>readFileReview({store:async()=>s,key:()=>key,scopes:['aeroastro']}));
});
