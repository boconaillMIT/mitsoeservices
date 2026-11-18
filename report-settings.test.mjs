import test from 'node:test';
import assert from 'node:assert/strict';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import {createSettingsHandler} from './src/report-settings.mjs';
import {createSettingsPageHandler} from './src/settings-page.mjs';
import {mainNavigation} from './src/navigation.cjs';
const copy=x=>x===undefined?undefined:structuredClone(x);
function fixture(){const data=policy.initialPolicy();for(const [username,scope,role]of [['unitadmin','aeroastro','admin'],['unitread','be','read'],['limited','school','limited_read'],['hqread','school','read'],['hqwrite','school','write']])data.grants.push({username,scope,role});const entries=new Map();let version=0;const store={async get(k){return copy(entries.get(k)?.data)||null;},async getWithMetadata(k){return copy(entries.get(k))||null;},async setJSON(k,value,options={}){const old=entries.get(k);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};entries.set(k,{data:copy(value),etag:String(++version)});return {modified:true};}};const authorize=user=>(e,o)=>access.authorize(e,{...o,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'p'})});return {entries,authorize,handler:user=>createSettingsHandler({authorize:authorize(user),store:async()=>store,devices:async()=>({devices:[],activity:[]})})};}
const get={httpMethod:'GET',headers:{}};
const post=body=>({httpMethod:'POST',headers:{origin:'https://mitsoeservices.netlify.app','content-type':'application/json'},body:JSON.stringify(body)});
const parse=r=>JSON.parse(r.body);process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
test('Settings pages and API are school-full only, and navigation preserves unit administration',async()=>{
 const f=fixture();for(const user of ['unitadmin','unitread','limited',null]){assert.equal((await f.handler(user)(get)).statusCode,user?403:401);const page=await createSettingsPageHandler(f.authorize(user))({...get,path:'/settings'});assert.equal(page.statusCode,user?403:302);}assert.equal(f.entries.size,0);
 for(const user of ['oconaill','juliekuk','hqread','hqwrite']){const r=await f.handler(user)(get);assert.equal(r.statusCode,200);const d=parse(r);assert.equal(d.owner,user);assert.equal(d.schedulingActive,false);assert.equal(d.reports.length,['hqread','hqwrite'].includes(user)?0:2);}
 const nav=mainNavigation({manage:true,schoolAdmin:true});assert.ok(nav.indexOf('>Settings<')<nav.indexOf('>Manage access<'));assert.ok(nav.includes('/settings/automatic-reports'));assert.ok(!mainNavigation({manage:true}).includes('>Settings<'));assert.ok(mainNavigation({manage:true}).includes('href="/admin"'));assert.ok(!mainNavigation({schoolAccess:true}).includes('Manage access'));
});
test('Own preferences persist, start disabled, and cannot modify another user or report scope',async()=>{
 const f=fixture(),h=f.handler('oconaill'),original=parse(await h(get));assert.ok(Object.values(original.preferences.reports).every(r=>!r.enabled));original.preferences.reports.balances.enabled=true;
 const saved=await h(post({version:original.version,preferences:original.preferences}));assert.equal(saved.statusCode,200);assert.equal(parse(await h(get)).preferences.reports.balances.enabled,true);assert.equal(parse(await f.handler('juliekuk')(get)).preferences.reports.balances.enabled,false);
 assert.equal((await h(post({owner:'juliekuk',version:parse(saved).version,preferences:original.preferences}))).statusCode,400);
 const p=parse(await h(get));p.preferences.reports.secret={enabled:true,frequency:'daily',day:'1',time:'09:00'};assert.equal((await h(post({version:p.version,preferences:p.preferences}))).statusCode,400);
});
test('Cross-origin saves, invalid schedules, and concurrent edits are rejected',async()=>{
 const f=fixture(),h=f.handler('oconaill'),d=parse(await h(get));const request=post({version:d.version,preferences:d.preferences});request.headers.origin='https://evil.example';assert.equal((await h(request)).statusCode,403);
 for(const mutate of [p=>p.timezone='invalid-zone',p=>p.reports.balances.time='25:00',p=>{p.reports.nimbus.frequency='weekly';p.reports.nimbus.day='7';},p=>p.reports.balances.enabled='yes']){const prefs=copy(d.preferences);mutate(prefs);assert.equal((await h(post({version:d.version,preferences:prefs}))).statusCode,400);}
 assert.equal((await h(post({version:d.version,preferences:d.preferences}))).statusCode,200);assert.equal((await h(post({version:d.version,preferences:d.preferences}))).statusCode,409);
});
