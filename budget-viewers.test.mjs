import test from 'node:test';import assert from 'node:assert/strict';
import access from './src/access.cjs';import policy from './src/policy.cjs';import features from './src/features.cjs';
import {createBudgetHqDataHandler,NOTE_SECTIONS,unitKeyFor} from './src/budget-hq.mjs';
import {createBudgetHqPageHandler} from './src/budget-hq-pages.mjs';
import {createServiceHubHandler} from './src/service-hub.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {createMyUnitHandler} from './src/my-unit.mjs';
import {createAdminHandler} from './src/admin-api.mjs';
const ORIGIN='https://example.test';
function state(){const p=policy.initialPolicy();p.grants.push({username:'viewer',scope:'budget:cee',role:'read'},{username:'viewer',scope:'budget:meche',role:'read'},{username:'unit_admin',scope:'cee',role:'admin'},{username:'rct_editor',scope:'rct',role:'write'},{username:'hq_reader',scope:'school',role:'read'},{username:'hq_writer',scope:'school',role:'write'});return p;}
const auth=(data,username)=>(event,options)=>access.authorize(event,{...options,reader:async()=>({kerberos:username}),load:async()=>({data,etag:'one'}),loadFeatures:async()=>({data:features.defaults()})});
const asks=[['1','CEE',2028,120,'Example CEE ask'],['2','Mechanical Engineering',2028,150,'Example MechE ask'],['3','EECS',2028,900,'PRIVATE OTHER DEPARTMENT'],['4','CEE',2027,100,'Example prior CEE ask']].map(([record_id,unit,year,requested,description])=>({record_id,unit,unit_key:unitKeyFor(unit),year,requested,original:description,request:description,revised:'',recurring:null,onetime:requested,school:year===2027?100:null,provost:null,scc:null,unresolved:null,declined:null,source:{schema:1,sources:[]}}));
const event=(query={})=>({httpMethod:'GET',headers:{},queryStringParameters:{cycle:'fy28',...query}});
function handler(data=state(),username='viewer'){
 const calls={asks:0,unit:[],write:0,cycle:0,reserves:0};
 const store={configured:()=>true,unit:async(cycle,unit)=>{calls.unit.push(unit);return {decisions:{},sections:Object.fromEntries(Object.keys(NOTE_SECTIONS).map(k=>[k,{text:'Example '+unit+' briefing',version:null}])),link:{url:'https://drive.google.com/drive/folders/'+unit+'-example-abcdefgh'},log:[]};},cycleDecisions:async()=>{calls.cycle++;return {};},saveBriefing:async()=>{calls.write++;throw Error('Unexpected write');},saveDecision:async()=>{calls.write++;throw Error('Unexpected write');},saveLink:async()=>{calls.write++;throw Error('Unexpected write');}};
 return {calls,run:createBudgetHqDataHandler({authorize:auth(data,username),asks:async()=>{calls.asks++;return asks;},store,reserves:async()=>{calls.reserves++;throw Error('Unexpected reserves access');},appOrigin:ORIGIN})};
}
test('budget viewer scopes are read-only, separately assigned and managed only by school admins',async()=>{
 const p=state();assert.deepEqual(Object.keys(policy.roleLabels('budget:cee')),['read']);for(const role of ['write','admin','limited_read'])assert.throws(()=>policy.validatePolicy({...p,grants:[...p.grants,{username:'new_user',scope:'budget:eecs',role}]}));
 for(const scope of ['school','cee','meche','rct'])assert.equal(policy.effectiveRole(p,'viewer',scope),null);
 assert(!policy.managedScopes(p,'unit_admin').includes('budget:cee'));assert(policy.managedScopes(p,'oconaill').includes('budget:cee'));
 const reader=createAdminHandler({authorize:auth(p,'viewer')});assert.equal((await reader(new Request(ORIGIN+'/.netlify/functions/admin-access'))).status,403);
 const admin=createAdminHandler({authorize:auth(p,'oconaill')}),result=await (await admin(new Request(ORIGIN+'/.netlify/functions/admin-access'))).json();assert.equal(result.roleLabels['budget:cee'].read,'Budget viewer (read-only, selected department)');
});
test('scoped directory contains only assigned names and never loads school-wide financial data',async()=>{
 const h=handler(),r=await h.run(event()),d=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(d.restricted,true);assert.deepEqual(d.units.map(u=>u.key),['cee','meche']);assert.equal(d.can_edit,false);assert(!Object.hasOwn(d,'totals'));assert.equal(h.calls.asks,0);assert.equal(h.calls.cycle,0);assert.doesNotMatch(r.body,/EECS|PRIVATE OTHER/);
 assert.equal((await h.run(event({format:'csv'}))).statusCode,403);assert.equal(h.calls.asks,0);
});
test('department pages include authorized history and briefing but no peer reserves or other departments',async()=>{
 const h=handler();for(const unit of ['cee','meche']){const r=await h.run(event({unit})),d=JSON.parse(r.body);assert.equal(r.statusCode,200);assert.equal(d.can_edit,false);assert.equal(d.reserves,null);assert(d.notes.sections.talking.text.includes(unit));assert(d.folder.url.includes(unit));assert.doesNotMatch(r.body,/PRIVATE OTHER/);}
 assert.equal(h.calls.reserves,0);assert.equal(h.calls.cycle,0);
 const csv=await h.run(event({unit:'cee',format:'csv'}));assert.equal(csv.statusCode,200);assert.match(csv.headers['Content-Type'],/text\/csv/);assert.match(csv.body,/Example CEE ask/);assert.doesNotMatch(csv.body,/MechE|PRIVATE OTHER/);
});
test('guessed department links and all mutation types fail before loading data or writing',async()=>{
 const h=handler();assert.equal((await h.run(event({unit:'eecs'}))).statusCode,403);assert.equal(h.calls.asks,0);assert.deepEqual(h.calls.unit,[]);
 for(const action of ['notes','decision','folder']){const r=await h.run({httpMethod:'PUT',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({cycle:'fy28',unit:'cee',action,section:'talking',text:'Tampered',record_id:'1',decision:'decline',url:''})});assert.equal(r.statusCode,403);}
 assert.equal(h.calls.asks,0);assert.equal(h.calls.write,0);
 const direct=await h.run({...event({unit:'eecs'}),path:'/.netlify/functions/budget-hq-data'});assert.equal(direct.statusCode,403);
});
test('budget navigation, submission pages and home show only the assigned budget area',async()=>{
 const p=state(),authorize=auth(p,'viewer'),pages=createBudgetHqPageHandler(authorize),hub=createServiceHubHandler(authorize);
 assert.equal((await pages({...event(),path:'/soe-hq/budget/fy28/cee'})).statusCode,200);assert.equal((await pages({...event({unit:'cee'}),path:'/soe-hq/budget/fy28/eecs'})).statusCode,403);
 const root=await pages({...event(),path:'/soe-hq/budget'});assert.match(root.body,/My department budgets/);assert.doesNotMatch(root.body,/href="\/academic-units"|href="\/soe-hq"/);
 const submissions=await hub({...event(),path:'/soe-hq/budget-submissions/fy28'});assert.equal(submissions.statusCode,200);assert.match(submissions.body,/fy28\/cee/);assert.match(submissions.body,/fy28\/meche/);assert.doesNotMatch(submissions.body,/fy28\/eecs/);
 for(const path of ['/soe-hq','/soe-hq/budget-explorer','/soe-hq/budget-explorer-legacy','/soe-hq/reserves'])assert.equal((await hub({...event(),path})).statusCode,403,path);
 const home=await createDashboardHandler(authorize)({...event(),path:'/'});assert.equal(home.statusCode,200);assert.match(home.body,/My department budgets/);assert.doesNotMatch(home.body,/href="\/soe-hq\/rct-review"|href="\/academic-units"/);
 assert.equal((await createMyUnitHandler(authorize)(event())).headers.Location,'/soe-hq/budget');
});
test('scope removal takes effect on the next request and old unit or RCT grants do not grant budget access',async()=>{
 const p=state(),h=handler(p);assert.equal((await h.run(event({unit:'cee'}))).statusCode,200);p.grants=p.grants.filter(g=>!(g.username==='viewer'&&g.scope==='budget:cee'));assert.equal((await h.run(event({unit:'cee'}))).statusCode,403);assert.equal((await h.run(event({unit:'meche'}))).statusCode,200);
 for(const username of ['unit_admin','rct_editor'])assert.equal((await handler(p,username).run(event({unit:'cee'}))).statusCode,403);
 const full=handler(p,'hq_reader'),result=JSON.parse((await full.run(event())).body);assert(result.totals);assert(result.units.some(u=>u.key==='eecs'));
});
test('unrelated administrator permissions cannot turn a department budget viewer into a writer',async()=>{
 const p=state();p.grants.push({username:'viewer',scope:'rct',role:'admin'},{username:'viewer',scope:'eecs',role:'admin'});
 const h=handler(p),result=JSON.parse((await h.run(event({unit:'cee'}))).body);assert.equal(result.restricted,true);assert.equal(result.can_edit,false);
 assert.equal((await h.run(event({unit:'eecs'}))).statusCode,403);
 assert.equal((await h.run({httpMethod:'PUT',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({cycle:'fy28',unit:'cee',action:'notes',section:'talking',text:'Not allowed'})})).statusCode,403);assert.equal(h.calls.write,0);
});
test('school admins can add and remove independent budget-only grants with audit and concurrency checks',async()=>{
 let data=policy.initialPolicy(),etag='one';const store={getWithMetadata:async()=>({data:structuredClone(data),etag}),setJSON:async(key,next,options)=>{if(options.onlyIfMatch!==etag)return {modified:false};data=structuredClone(next);etag+='x';return {modified:true};}};
 let r=await policy.changePolicy('oconaill','add','viewer',etag,store,{scope:'budget:cee',role:'read'});assert.equal(r.status,200);r=await policy.changePolicy('oconaill','add','viewer',etag,store,{scope:'budget:meche',role:'read'});assert.equal(r.status,200);assert.equal(data.grants.filter(g=>g.username==='viewer').length,2);
 assert.equal((await policy.changePolicy('unit_admin','add','viewer',etag,store,{scope:'budget:eecs',role:'read'})).status,403);assert.equal((await policy.changePolicy('oconaill','add','viewer',etag,store,{scope:'budget:cee',role:'write'})).status,400);
 assert.equal((await policy.changePolicy('oconaill','remove','viewer','old',store,{scope:'budget:cee',role:'read'})).status,409);
 assert.equal((await policy.changePolicy('oconaill','remove','viewer',etag,store,{scope:'budget:cee',role:'read'})).status,200);assert.equal(data.grants.filter(g=>g.username==='viewer').length,1);assert.equal(data.audit.at(-1).scope,'budget:cee');
});
