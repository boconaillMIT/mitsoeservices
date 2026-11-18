import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createBudgetHqDataHandler,validateDecision,applyDecision,rollUp,unitKeyFor,parseCycle,validFilename} from './src/budget-hq.mjs';
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
function memoryVault(){const m=new Map();let n=0;return {m,async get(p){const e=m.get(p);return e?{value:structuredClone(e.value),etag:e.etag}:{value:null,etag:null};},
 async put(p,value,etag){const cur=m.get(p);if((cur?.etag||null)!==(etag||null))return {conflict:true};const t='v'+(++n);m.set(p,{value:structuredClone(value),etag:t});return {etag:t};},async remove(p){m.delete(p);}};}
const ORIGIN='https://mitsoeservices.netlify.app';
let ids=0;
const handler=(user,repo=memoryRepo(),extra={})=>createBudgetHqDataHandler({authorize:authorize(state(),user),asks:async()=>ASKS,repo,vault:extra.vault||memoryVault(),reserves:async()=>({units:[],definitions:{}}),now:()=>new Date('2026-11-18T12:00:00Z'),uuid:()=>'00000000-0000-4000-8000-'+String(++ids).padStart(12,'0'),appOrigin:ORIGIN,...extra});
const send=(method,h,body,headers={origin:ORIGIN,'content-type':'application/json'})=>h({httpMethod:method,headers,body:JSON.stringify({cycle:'fy28',...body})}).then(r=>{let json=null;try{json=JSON.parse(r.body);}catch{}return {...r,json};});
const put=(h,body,headers)=>send('PUT',h,body,headers);
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

test('writes require a same-origin JSON request',async()=>{
 const h=handler('oconaill');
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'},{origin:'https://evil.example','content-type':'application/json'})).statusCode,403);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'},{origin:ORIGIN,'content-type':'text/plain'})).statusCode,403);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'})).statusCode,200);
});
test('Dean’s briefing: four sections, readers see them, writers edit with conflict protection and history',async()=>{
 const vault=memoryVault(),w=handler('school_writer',memoryRepo(),{vault}),r=handler('school_reader',memoryRepo(),{vault});
 let u=await get(r,{unit:'eecs'});assert.deepEqual(Object.keys(u.json.notes.sections),['talking','background','questions','recommendation']);assert.equal(u.json.notes_etag,null);
 assert.equal((await put(r,{action:'notes',unit:'eecs',section:'talking',text:'x',etag:null})).statusCode,403,'readers cannot edit');
 assert.equal((await put(w,{action:'notes',unit:'eecs',section:'gossip',text:'x',etag:null})).statusCode,400);
 assert.equal((await put(w,{action:'notes',unit:'eecs',section:'talking',text:'x'.repeat(10001),etag:null})).statusCode,400);
 const s1=await put(w,{action:'notes',unit:'eecs',section:'talking',text:'- Thank them for the TA plan\n- Ask about reserves',etag:null});assert.equal(s1.statusCode,200);
 assert.equal((await put(w,{action:'notes',unit:'eecs',section:'background',text:'stale',etag:null})).statusCode,409,'stale etag refused');
 const s2=await put(w,{action:'notes',unit:'eecs',section:'talking',text:'- Revised',etag:s1.json.etag});assert.equal(s2.statusCode,200);
 u=await get(r,{unit:'eecs'});assert.equal(u.json.notes.sections.talking.text,'- Revised');assert.equal(u.json.notes.sections.talking.updated_by,'school_writer');
 assert.equal(u.json.notes.history[0].previous,'- Thank them for the TA plan\n- Ask about reserves','previous text kept');
 assert.equal((await put(w,{action:'notes',unit:'not-a-unit',section:'talking',text:'x'})).statusCode,404);
});
test('documents: encrypted vault round trip, validation, readers download, writers upload and delete',async()=>{
 const vault=memoryVault(),w=handler('school_writer',memoryRepo(),{vault}),r=handler('school_reader',memoryRepo(),{vault});
 const data=Buffer.from('%PDF-1.4 test').toString('base64');
 assert.ok(validFilename('FY28 EECS final.docx'));assert.ok(!validFilename('../x.pdf'));assert.ok(!validFilename('run.exe'));assert.ok(!validFilename('.hidden.pdf'));
 assert.equal((await send('POST',r,{action:'upload',unit:'eecs',filename:'a.pdf',data,etag:null})).statusCode,403);
 assert.equal((await send('POST',w,{action:'upload',unit:'eecs',filename:'a.exe',data,etag:null})).statusCode,400);
 assert.equal((await send('POST',w,{action:'upload',unit:'eecs',filename:'a.pdf',data:'not base64!',etag:null})).statusCode,400);
 const up=await send('POST',w,{action:'upload',unit:'eecs',filename:'FY28 submission.pdf',label:'Final submission',data,etag:null});assert.equal(up.statusCode,200);
 const meta=up.json.files[0];assert.equal(meta.size,13);assert.equal(meta.uploaded_by,'school_writer');
 const u=await get(r,{unit:'eecs'});assert.equal(u.json.files.length,1);
 const dl=await r({httpMethod:'GET',queryStringParameters:{cycle:'fy28',unit:'eecs',file:meta.id}});assert.equal(dl.statusCode,200);assert.equal(dl.body.toString(),'%PDF-1.4 test');
 assert.match(dl.headers['Content-Disposition'],/attachment/);assert.equal(dl.headers['X-Content-Type-Options'],'nosniff');
 assert.equal((await r({httpMethod:'GET',queryStringParameters:{cycle:'fy28',unit:'cee',file:meta.id}})).statusCode,404,'file is bound to its unit');
 const stale=await send('DELETE',w,{action:'delete-file',unit:'eecs',id:meta.id,etag:null});assert.equal(stale.statusCode,409);
 const del=await send('DELETE',w,{action:'delete-file',unit:'eecs',id:meta.id,etag:up.json.etag});assert.equal(del.statusCode,200);assert.deepEqual(del.json.files,[]);
 assert.ok(![...vault.m.keys()].some(k=>k.includes('/file/')),'file content removed');
});
test('vault encrypts at rest, binds each record to its path, and enforces etags',async()=>{
 const {createVault}=await import('./src/budget-hq.mjs');process.env.UNIT_FILES_DATA_KEY='k'.repeat(40);
 const raw=new Map();let n=0;const store={async getWithMetadata(k){const e=raw.get(k);return e?{data:e.data,etag:e.etag}:null;},async set(k,data,o={}){const cur=raw.get(k);if(o.onlyIfNew&&cur)return {modified:false};if(o.onlyIfMatch&&cur?.etag!==o.onlyIfMatch)return {modified:false};const etag='r'+(++n);raw.set(k,{data,etag});return {modified:true,etag};},async delete(k){raw.delete(k);}};
 const v=createVault({store});const w=await v.put('fy28/eecs/notes',{secret:'Ask about the TA plan'},null);
 assert.ok(!raw.get('fy28/eecs/notes').data.includes('TA plan'),'stored encrypted');
 assert.equal((await v.get('fy28/eecs/notes')).value.secret,'Ask about the TA plan');
 assert.equal((await v.put('fy28/eecs/notes',{x:1},'wrong')).conflict,true);assert.equal((await v.put('fy28/eecs/notes',{x:1},null)).conflict,true);
 raw.set('fy28/cee/notes',raw.get('fy28/eecs/notes'));await assert.rejects(()=>v.get('fy28/cee/notes'),'a record copied to another unit cannot be decrypted');
});
