import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createBudgetHqDataHandler,validateDecision,applyDecision,rollUp,unitKeyFor,parseCycle} from './src/budget-hq.mjs';
import {createBudgetHqPageHandler} from './src/budget-hq-pages.mjs';

function state(){const data=policy.initialPolicy();for(const [u,s,r] of [['unit_admin','aeroastro','admin'],['school_limited','school','limited_read'],['school_reader','school','read'],['school_writer','school','write']])data.grants.push({username:u,scope:s,role:r});return data;}
const authorize=(data,user)=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'t'})});
const ask=(id,unit,year,base,non,desc='Request '+id)=>({record_id:String(id),unit,year,requested:(base||0)+(non||0),recurring:base,onetime:non,original:desc,revised:'',request:desc,category:'Staff',decision:'',provost:null,school:null,unresolved:null,declined:null,unit_key:unitKeyFor(unit)});
const ASKS=[ask(1,'Aero-Astro',2028,100000,50000),ask(2,'Aero-Astro',2028,null,200000),ask(3,'EECS',2028,0,400000),ask(4,'Aero-Astro',2027,0,90000),ask(5,'Mystery Lab',2028,0,10000)];
ASKS[3]={...ASKS[3],provost:30000,school:20000};
function memoryRepo(){const m=new Map();let n=0;return {m,
 async read(c,u){const e=m.get(c+'/'+u);return e?{doc:structuredClone(e.doc),etag:e.etag}:{doc:{schema:1,cycle:c,unit:u,decisions:{},audit:[]},etag:null};},
 async readAll(c){return Object.fromEntries([...m].filter(([k])=>k.startsWith(c+'/')).map(([k,v])=>[k.slice(c.length+1),structuredClone(v.doc)]));},
 async write(c,u,doc,etag){const cur=m.get(c+'/'+u);if((cur?.etag||null)!==(etag||null))return {conflict:true};const t='e'+(++n);m.set(c+'/'+u,{doc:structuredClone(doc),etag:t});return {etag:t};}};}
const handler=(user,repo=memoryRepo(),extra={})=>createBudgetHqDataHandler({authorize:authorize(state(),user),asks:async()=>ASKS,repo,reserves:async()=>({units:[],definitions:{}}),now:()=>new Date('2026-11-18T12:00:00Z'),...extra});
const put=(h,body)=>h({httpMethod:'PUT',body:JSON.stringify({cycle:'fy28',...body})}).then(r=>{let json=null;try{json=JSON.parse(r.body);}catch{}return {...r,json};});
const get=(h,q)=>h({httpMethod:'GET',queryStringParameters:{cycle:'fy28',...q}}).then(r=>({...r,json:(r.headers?.['Content-Type']||'').includes('json')?JSON.parse(r.body):r.body}));

test('decision maths: support level and SoE/Provost split, with recurring/one-time split',()=>{
 const a=ASKS[0],d=applyDecision(a,{decision:'support',support_pct:50,soe_pct:40});
 assert.deepEqual([d.supported,d.soe,d.provost,d.provost_pct,d.supported_recurring,d.supported_onetime],[75000,30000,45000,60,50000,25000]);
 assert.deepEqual([applyDecision(a,{decision:'decline'}).supported,applyDecision(a).supported],[0,null]);
 const t=rollUp([{...a,...d},{...ASKS[1],...applyDecision(ASKS[1],{decision:'decline'})}]);assert.deepEqual([t.requested,t.supported,t.soe,t.provost,t.declined_requested,t.pending],[350000,75000,30000,45000,200000,0]);
});
test('decision validation',()=>{
 assert.ok(validateDecision({decision:'approve'}).error);assert.ok(validateDecision({decision:'support',support_pct:0,soe_pct:50}).error);
 assert.ok(validateDecision({decision:'support',support_pct:120,soe_pct:50}).error);assert.ok(validateDecision({decision:'support',support_pct:50,soe_pct:-1}).error);
 assert.ok(validateDecision({decision:'support',support_pct:33.33,soe_pct:50}).error,'one decimal place');assert.ok(validateDecision({decision:'decline',note:'x'.repeat(1001)}).error);
 assert.deepEqual(validateDecision({decision:'support',support_pct:'62.5',soe_pct:'50'}).value,{decision:'support',support_pct:62.5,soe_pct:50,note:''});
 assert.deepEqual([parseCycle('FY28')?.year,parseCycle('fy2028'),parseCycle('x')],[2028,null,null]);
});
test('school readers can view, only school writers/admins can decide; unit admins and limited users cannot see',async()=>{
 for(const u of ['unit_admin','school_limited'])assert.equal((await get(handler(u),{})).statusCode,403);
 assert.equal((await get(handler(null),{})).statusCode,401);
 const r=await get(handler('school_reader'),{unit:'aeroastro'});assert.equal(r.statusCode,200);assert.equal(r.json.can_edit,false);
 assert.equal((await put(handler('school_reader'),{unit:'aeroastro',record_id:'1',decision:'decline'})).statusCode,403);
 assert.equal((await get(handler('school_writer'),{unit:'aeroastro'})).json.can_edit,true);
 assert.equal((await get(handler('oconaill'),{unit:'aeroastro'})).json.can_edit,true);
});
test('unit page: this cycle’s lines only, history from earlier years, conflicts are refused, audit kept',async()=>{
 const repo=memoryRepo(),h=handler('school_writer',repo);
 let r=await get(h,{unit:'aeroastro'});assert.deepEqual(r.json.lines.map(l=>l.record_id),['2','1']);assert.deepEqual(r.json.history.map(y=>[y.year,y.requested,y.approved]),[[2027,90000,50000]]);
 const e0=r.json.etag;assert.equal(e0,null);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'3',decision:'decline',etag:e0})).statusCode,404,'EECS line cannot be set from the AeroAstro page');
 const s1=await put(h,{unit:'aeroastro',record_id:'1',decision:'support',support_pct:50,soe_pct:40,note:'Ask Provost to share',etag:e0});assert.equal(s1.statusCode,200);assert.equal(s1.json.line.provost,45000);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'2',decision:'decline',etag:e0})).statusCode,409,'stale etag refused');
 assert.equal((await put(h,{unit:'aeroastro',record_id:'2',decision:'decline',etag:s1.json.etag})).statusCode,200);
 r=await get(h,{unit:'aeroastro'});assert.deepEqual([r.json.totals.supported,r.json.totals.soe,r.json.totals.provost,r.json.totals.pending],[75000,30000,45000,0]);
 assert.equal(r.json.audit.length,2);assert.equal(r.json.audit[0].by,'school_writer');assert.equal(r.json.audit[1].to.support_pct,50);
});
test('cycle roll-up lists every academic unit plus unmapped request groups; CSV export is safe',async()=>{
 const repo=memoryRepo(),h=handler('oconaill',repo);
 await put(h,{unit:'eecs',record_id:'3',decision:'support',support_pct:100,soe_pct:25,note:'=HYPERLINK("x")'});
 const r=await get(h,{});const eecs=r.json.units.find(u=>u.key==='eecs'),mystery=r.json.units.find(u=>u.label==='Mystery Lab');
 assert.deepEqual([eecs.supported,eecs.soe,eecs.provost],[400000,100000,300000]);assert.equal(mystery.has_wallet,false);assert.ok(r.json.units.some(u=>u.key==='nse'&&u.lines===0));
 assert.equal(r.json.totals.requested,760000);
 const csv=await get(h,{format:'csv'});assert.match(csv.headers['Content-Disposition'],/FY28/);assert.match(csv.body,/"'=HYPERLINK\(""x""\)"/);assert.equal(csv.body.split('\r\n').length,5);
});
test('pages: section, cycle and unit shells need school access; bad cycles 404',async()=>{
 const p=u=>createBudgetHqPageHandler(authorize(state(),u));
 assert.equal((await p('unit_admin')({httpMethod:'GET',queryStringParameters:{}})).statusCode,403);
 const login=await p(null)({httpMethod:'GET',queryStringParameters:{cycle:'fy28',unit:'eecs'}});assert.equal(login.statusCode,302);assert.match(login.headers.Location,/returnTo=%2Fsoe-hq%2Fbudget%2Ffy28%2Feecs/);
 const hub=await p('school_reader')({httpMethod:'GET',queryStringParameters:{}});assert.match(hub.body,/FY28 budget cycle/);assert.ok(!hub.body.includes('/soe-hq/reserves'),'admin-only tools hidden from readers');
 assert.match((await p('oconaill')({httpMethod:'GET',queryStringParameters:{}})).body,/\/soe-hq\/reserves/);
 const unit=await p('school_reader')({httpMethod:'GET',queryStringParameters:{cycle:'fy28',unit:'eecs'}});assert.match(unit.body,/data-unit="eecs"/);assert.match(unit.body,/budget-hq\.js/);
 assert.equal((await p('oconaill')({httpMethod:'GET',queryStringParameters:{cycle:'2028'}})).statusCode,404);
 assert.equal((await p('oconaill')({httpMethod:'GET',queryStringParameters:{cycle:'fy28',unit:'../x'}})).statusCode,404);
});
