import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import features from './src/features.cjs';
import units from './src/units.cjs';
import summary from './src/authorization-summary.cjs';
import {pageAudience} from './src/audience.cjs';
import {createAdminHandler} from './src/admin-api.mjs';
import {createUnitDataHandler} from './src/unit-data.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {points,combinedPoints,trendComparison} from './public/wallet-comparison-model.mjs';
const state=()=>({...policy.initialPolicy(),grants:[...policy.initialPolicy().grants,{username:'reader',scope:'budget:cee',role:'read'},{username:'reader',scope:'budget:meche',role:'read'},{username:'reader',scope:'rct',role:'write'},{username:'manager',scope:'cee',role:'admin'},{username:'wide',scope:'school',role:'read'},{username:'limited',scope:'be',role:'limited_read'}]});
const auth=(username,data=state())=>(event,options)=>access.authorize(event,{...options,reader:async()=>({kerberos:username}),load:async()=>({data,etag:'example'}),loadFeatures:async()=>({data:features.defaults()})});
test('personal summary distinguishes explicit budget, RCT and limited finance permissions',()=>{
 const entries=summary.authorizationSummary(state(),'reader');assert.deepEqual(entries.map(e=>e.scope),['rct','budget:cee','budget:meche']);assert.equal(entries[0].role,'write');assert.equal(entries[1].href,'/soe-hq/budget/fy28/cee');
 const limited=summary.authorizationSummary(state(),'limited');assert.equal(limited[0].href,'/units/be/limited');assert.equal(limited[0].role,'limited_read');assert.deepEqual(summary.authorizationSummary(state(),'unknown'),[]);
});
test('school access is inherited, RCT remains separate, and recovery admins appear in RCT audience',()=>{
 const entries=summary.authorizationSummary(state(),'wide');assert(!entries.some(e=>e.scope==='rct'||e.scope.startsWith('budget:')));assert.equal(entries.find(e=>e.scope==='cee').source,'School-wide access');
 const audience=pageAudience(state(),'rct');assert(audience.some(p=>p.username==='oconaill'));assert(audience.some(p=>p.username==='reader'));assert(!audience.some(p=>p.username==='wide'));
});
test('lookup exposes all authorizations only to school admins and filters unit managers',async()=>{
 const lookup=(who,username)=>createAdminHandler({authorize:auth(who)})(new Request('https://example.test/.netlify/functions/admin-access?username='+username));
 let response=await lookup('oconaill','reader@mit.edu');assert.equal(response.status,200);assert.equal((await response.json()).authorizations.length,3);
 response=await lookup('manager','reader');let data=await response.json();assert.equal(data.limitedToManagedAreas,true);assert.deepEqual(data.authorizations,[]);
 response=await lookup('manager','wide');data=await response.json();assert.deepEqual(data.authorizations.map(e=>e.scope),['cee']);assert.equal(data.authorizations[0].source,'School-wide access');
 assert.equal((await lookup('reader','wide')).status,403);assert.equal((await lookup('oconaill','bad%3Cscript%3E')).status,400);
});
test('personal authorizations page exposes only signed-in user permissions',async()=>{
 const handler=createDashboardHandler(auth('reader'));const page=await handler({httpMethod:'GET',path:'/my-authorizations',queryStringParameters:{username:'oconaill'}});assert.equal(page.statusCode,200);assert.match(page.body,/reader@mit.edu/);assert.match(page.body,/Budget viewer/);assert.doesNotMatch(page.body,/oconaill@mit.edu/);
});
const payload=scope=>({schema:1,scope,statement:{id:'fake',unit:units.WALLETS[scope].source,status:'Verified',cycle:2028},rows:[{statement_id:'fake',unit:units.WALLETS[scope].source,cycle:2028,type:'GIB Carryforward',year:2027,admin:'DP',amount:100,account:'FAKE-PRIVATE',period:'202612'}]});
test('wallet comparison requires school finance access before reading any wallets',async()=>{
 for(const user of ['reader','manager','limited']){let reads=0;const handler=createUnitDataHandler({authorize:auth(user),read:async()=>{reads++;}});assert.equal((await handler({httpMethod:'GET',queryStringParameters:{unit:'school',action:'compare'}})).statusCode,403);assert.equal(reads,0);}
});
test('comparison includes ten real academic units, excludes managed wallets and strips accounts',async()=>{
 const calls=[],handler=createUnitDataHandler({authorize:auth('wide'),read:async scope=>{calls.push(scope);return payload(scope);}});
 const response=await handler({httpMethod:'GET',queryStringParameters:{unit:'school',action:'compare'}});assert.equal(response.statusCode,200);const data=JSON.parse(response.body);assert.equal(data.units.length,10);assert.equal(calls.length,11);assert(!calls.includes('soe-fake'));assert(!calls.includes('archaeology'));assert.doesNotMatch(response.body,/FAKE-PRIVATE/);
});
test('missing or invalid snapshots are explicitly unavailable, never substituted',async()=>{
 const handler=createUnitDataHandler({authorize:auth('wide'),read:async scope=>scope==='cee'?null:payload(scope==='be'?'eecs':scope)});const data=JSON.parse((await handler({httpMethod:'GET',queryStringParameters:{unit:'school',action:'compare'}})).body);assert.deepEqual(data.unavailable.sort(),['be','cee']);assert.equal(data.wallets.length,9);
});
const example=(values,{period='12',projection=false}={})=>({cycle:2028,rows:values.map(([year,amount])=>({type:'GIB Carryforward',year,amount,admin:'DP',period:String(year)+period,projection}))});
test('combined history requires all units and compatible periods, preserving wallet carryforward zeros',()=>{
 const a=example([[2026,100],[2027,200]]),b=example([[2026,50],[2027,70]]);assert.deepEqual(combinedPoints([a,b],'GIB Carryforward',2).map(p=>p.amount),[150,270]);assert.deepEqual(combinedPoints([a],'GIB Carryforward',2),[]);
 assert.deepEqual(combinedPoints([a,example([[2026,50],[2027,null]])],'GIB Carryforward',2).map(p=>p.amount),[150,200]);assert(combinedPoints([a,example([[2026,50]],{period:'02'})],'GIB Carryforward',2).every(p=>p.amount===null));
});
test('trend flags relative improvement in matched actual periods; projections and zero bases are explicit',()=>{
 const hq=points(example([[2025,200],[2026,100],[2027,80]]),'GIB Carryforward'),peer=points(example([[2025,100],[2026,120],[2027,140]]),'GIB Carryforward');const result=trendComparison(hq,peer);assert.equal(result.stronger,true);assert.equal(result.hq.percent,-60);assert.equal(result.unit.percent,40);
 assert.equal(trendComparison(hq,points(example([[2026,100],[2027,120]],{projection:true}),'GIB Carryforward')),null);assert.equal(trendComparison(hq,points(example([[2026,100],[2027,120]],{period:'02'}),'GIB Carryforward')),null);
 assert.equal(trendComparison(hq,points(example([[2025,0],[2027,10]]),'GIB Carryforward')).stronger,null);
});

test('partially blank histories match existing wallet totals and show excluded blanks; payout is unit-wide',()=>{
 const wallet=example([[2026,100],[2026,null],[2027,200]]),series=points(wallet,'GIB Carryforward');assert.equal(series[0].amount,100);assert.equal(series[0].blanks,1);
 const payout={rows:[{type:'Pool A Payout',year:2026,admin:'',amount:50,period:'202616',projection:false}]};assert.equal(points(payout,'Pool A Payout')[0].amount,50);
});

test('reported carryforward zero is plotted, without turning absent groups or other blank resources into zero',()=>{
 const wallet=example([[2026,50],[2027,null],[2028,80]]),series=points(wallet,'GIB Carryforward');assert.equal(series[1].amount,0);assert.equal(series[1].walletZero,true);
 const absent={rows:[{type:'GIB Carryforward',year:2027,admin:'FC',amount:100}]};assert.equal(points(absent,'GIB Carryforward')[0].amount,null);
 const blankOther={rows:[{type:'Expendable Fund Balance',year:2027,admin:'DP',amount:null}]};assert.equal(points(blankOther,'Expendable Fund Balance')[0].amount,null);
 const hq=points(example([[2026,100],[2027,110],[2028,120]]),'GIB Carryforward');assert.equal(trendComparison(hq,series).from,2026);assert.equal(trendComparison(hq,series).to,2028);
 const combined=combinedPoints([wallet,example([[2026,20],[2027,10],[2028,30]])],'GIB Carryforward',2);assert.equal(combined[1].amount,10);assert.equal(combined[1].walletZero,false);
});
