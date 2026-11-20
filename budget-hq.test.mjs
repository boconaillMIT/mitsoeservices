import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createBudgetHqDataHandler,validateDecision,applyDecision,rollUp,unitKeyFor,parseCycle,validFolderUrl} from './src/budget-hq.mjs';
import {createBudgetHqPageHandler} from './src/budget-hq-pages.mjs';
import {createBudgetHqStore,FIELDS} from './src/budget-hq-qb.mjs';

function state(){const data=policy.initialPolicy();for(const [u,s,r] of [['unit_admin','aeroastro','admin'],['school_limited','school','limited_read'],['school_reader','school','read'],['school_writer','school','write']])data.grants.push({username:u,scope:s,role:r});return data;}
const authorize=(data,user)=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>user?{kerberos:user}:null,load:async()=>({data,etag:'t'})});
const ask=(id,unit,year,base,non,desc='Request '+id)=>({record_id:String(id),unit,year,requested:(base||0)+(non||0),recurring:base,onetime:non,original:desc,revised:'',request:desc,category:'Staff',decision:'',provost:null,school:null,unresolved:null,declined:null,unit_key:unitKeyFor(unit)});
const ASKS=[ask(1,'Aero-Astro',2028,100000,50000),ask(2,'Aero-Astro',2028,null,200000),ask(3,'EECS',2028,0,400000),ask(4,'Aero-Astro',2027,0,90000),ask(5,'Mystery Lab',2028,0,10000)];
ASKS[3]={...ASKS[3],provost:30000,school:20000};

// In-memory stand-in with the same interface and versioning rules as the QuickBase store.
function memoryStore(ready=true){let n=0;const d={},b={},l={},log=[];const v=()=>String(++n);
 return {d,log,configured:()=>ready,
  async cycleDecisions(c){const o={};for(const [k,x]of Object.entries(d)){const [cy,u,id]=k.split('|');if(cy===c)(o[u]||={})[id]=x;}return o;},
  async unit(c,u){const dec={};for(const [k,x]of Object.entries(d)){const [cy,uu,id]=k.split('|');if(cy===c&&uu===u)dec[id]=x;}
   const sections={};for(const s of ['talking','background','questions','recommendation'])sections[s]=b[`${c}|${u}|${s}`]||{text:'',updated_by:null,updated_at:null,version:null};
   return {decisions:dec,sections,link:l[`${c}|${u}`]||{url:'',version:null},log:log.filter(e=>e.c===c&&e.u===u).reverse()};},
  async saveDecision(c,u,id,val,ver,by,item){const k=`${c}|${u}|${id}`;if((d[k]?.version||null)!==(ver||null))return {conflict:true};d[k]={...val,updated_by:by,updated_at:'2026-11-18T12:00:00Z',version:v()};log.push({c,u,at:'2026-11-18T12:00:00Z',by,kind:'decision',item,change:val.decision});return {decision:d[k]};},
  async saveBriefing(c,u,s,text,ver,by){const k=`${c}|${u}|${s}`;if((b[k]?.version||null)!==(ver||null))return {conflict:true};b[k]={text,updated_by:by,updated_at:'2026-11-18T12:00:00Z',version:v()};return {section:b[k]};},
  async saveLink(c,u,url,ver,by){const k=`${c}|${u}`;if((l[k]?.version||null)!==(ver||null))return {conflict:true};l[k]={url,version:v()};return {link:l[k]};}};}
const ORIGIN='https://mitsoeservices.netlify.app';
const handler=(user,store=memoryStore(),extra={})=>createBudgetHqDataHandler({authorize:authorize(state(),user),asks:async()=>ASKS,store,reserves:async()=>({units:[],definitions:{}}),now:()=>new Date('2026-11-18T12:00:00Z'),appOrigin:ORIGIN,...extra});
const send=(method,h,body,headers={origin:ORIGIN,'content-type':'application/json'})=>h({httpMethod:method,headers,body:JSON.stringify({cycle:'fy28',...body})}).then(r=>{let json=null;try{json=JSON.parse(r.body);}catch{}return {...r,json};});
const put=(h,body,headers)=>send('PUT',h,body,headers);
const get=(h,q)=>h({httpMethod:'GET',queryStringParameters:{cycle:'fy28',...q}}).then(r=>({...r,json:(r.headers?.['Content-Type']||'').includes('json')?JSON.parse(r.body):r.body}));

test('decision maths: support level and SoE/Provost split, with recurring/one-time split',()=>{
 const a=ASKS[0],d=applyDecision(a,{decision:'support',support_pct:50,soe_pct:40});
 assert.deepEqual([d.supported,d.soe,d.provost,d.provost_pct,d.supported_recurring,d.supported_onetime],[75000,30000,45000,60,50000,25000]);
 assert.deepEqual([applyDecision(a,{decision:'decline'}).supported,applyDecision(a).supported],[0,null]);
 const t=rollUp([{...a,...d},{...ASKS[1],...applyDecision(ASKS[1],{decision:'decline'})}]);assert.deepEqual([t.requested,t.supported,t.soe,t.provost,t.declined_requested,t.pending],[350000,75000,30000,45000,200000,0]);
});
test('input validation: decisions, cycles and Drive folder links',()=>{
 assert.ok(validateDecision({decision:'approve'}).error);assert.ok(validateDecision({decision:'support',support_pct:0,soe_pct:50}).error);
 assert.ok(validateDecision({decision:'support',support_pct:33.33,soe_pct:50}).error);assert.ok(validateDecision({decision:'decline',note:'x'.repeat(1001)}).error);
 assert.deepEqual(validateDecision({decision:'support',support_pct:'62.5',soe_pct:'50'}).value,{decision:'support',support_pct:62.5,soe_pct:50,note:''});
 assert.deepEqual([parseCycle('FY28')?.year,parseCycle('fy2028'),parseCycle('x')],[2028,null,null]);
 assert.ok(validFolderUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp'));assert.ok(validFolderUrl('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp'));assert.ok(validFolderUrl(''));
 for(const bad of ['http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp','https://evil.example/drive/folders/1AbCdEfGhIjKlMnOp','https://drive.google.com.evil.example/drive/folders/1AbCdEfGhIjK','https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view','javascript:alert(1)','https://user:pw@drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp'])assert.ok(!validFolderUrl(bad),bad);
});
test('access: school readers view, school writers/admins decide; unit admins and limited users cannot see',async()=>{
 for(const u of ['unit_admin','school_limited'])assert.equal((await get(handler(u),{})).statusCode,403);
 assert.equal((await get(handler(null),{})).statusCode,401);
 const r=await get(handler('school_reader'),{unit:'aeroastro'});assert.equal(r.statusCode,200);assert.equal(r.json.can_edit,false);
 assert.equal((await put(handler('school_reader'),{unit:'aeroastro',record_id:'1',decision:'decline'})).statusCode,403);
 assert.equal((await get(handler('school_writer'),{unit:'aeroastro'})).json.can_edit,true);
});
test('writes require a same-origin JSON request',async()=>{
 const h=handler('oconaill');
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'},{origin:'https://evil.example','content-type':'application/json'})).statusCode,403);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'},{origin:ORIGIN,'content-type':'text/plain'})).statusCode,403);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'})).statusCode,200);
});
test('until the QuickBase tables are configured, pages load read-only and saves are refused',async()=>{
 const h=handler('oconaill',memoryStore(false));const r=await get(h,{unit:'aeroastro'});
 assert.equal(r.statusCode,200);assert.equal(r.json.storage_ready,false);assert.equal(r.json.can_edit,false);assert.equal(r.json.lines.length,2);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline'})).statusCode,503);
});
test('unit page: this cycle’s lines, history, per-line versions so different lines never collide',async()=>{
 const store=memoryStore(),h=handler('school_writer',store);
 let r=await get(h,{unit:'aeroastro'});assert.deepEqual(r.json.lines.map(l=>l.record_id),['2','1']);assert.deepEqual(r.json.history.map(y=>[y.year,y.requested,y.approved]),[[2027,90000,50000]]);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'3',decision:'decline'})).statusCode,404,'EECS line cannot be set from the AeroAstro page');
 const s1=await put(h,{unit:'aeroastro',record_id:'1',decision:'support',support_pct:50,soe_pct:40,note:'Ask Provost to share',version:null});assert.equal(s1.statusCode,200);assert.equal(s1.json.line.provost,45000);
 assert.equal((await put(h,{unit:'aeroastro',record_id:'2',decision:'decline',version:null})).statusCode,200,'a different line saves independently');
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline',version:null})).statusCode,409,'stale version refused');
 assert.equal((await put(h,{unit:'aeroastro',record_id:'1',decision:'decline',version:s1.json.line.version})).statusCode,200);
 r=await get(h,{unit:'aeroastro'});assert.deepEqual([r.json.totals.supported,r.json.totals.pending,r.json.totals.declined_count],[0,0,2]);assert.equal(r.json.log.length,3);
});
test('briefing and documents folder link save with version checks',async()=>{
 const h=handler('school_writer');
 assert.equal((await put(h,{action:'notes',unit:'eecs',section:'gossip',text:'x'})).statusCode,400);
 assert.equal((await put(h,{action:'notes',unit:'eecs',section:'talking',text:'x'.repeat(10001)})).statusCode,400);
 const n1=await put(h,{action:'notes',unit:'eecs',section:'talking',text:'- Point one',version:null});assert.equal(n1.statusCode,200);
 assert.equal((await put(h,{action:'notes',unit:'eecs',section:'talking',text:'stale',version:null})).statusCode,409);
 assert.equal((await put(h,{action:'notes',unit:'eecs',section:'talking',text:'- Revised',version:n1.json.section.version})).statusCode,200);
 assert.equal((await put(h,{action:'folder',unit:'eecs',url:'https://evil.example/x',version:null})).statusCode,400);
 const f=await put(h,{action:'folder',unit:'eecs',url:'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp',version:null});assert.equal(f.statusCode,200);
 const r=await get(h,{unit:'eecs'});assert.equal(r.json.notes.sections.talking.text,'- Revised');assert.match(r.json.folder.url,/drive\.google\.com/);
 assert.equal((await put(h,{action:'notes',unit:'not-a-unit',section:'talking',text:'x'})).statusCode,404);
});
test('cycle roll-up lists every academic unit plus unmapped request groups; CSV export is safe',async()=>{
 const h=handler('oconaill');
 await put(h,{unit:'eecs',record_id:'3',decision:'support',support_pct:100,soe_pct:25,note:'=HYPERLINK("x")'});
 const r=await get(h,{});const eecs=r.json.units.find(u=>u.key==='eecs'),mystery=r.json.units.find(u=>u.label==='Mystery Lab');
 assert.deepEqual([eecs.supported,eecs.soe,eecs.provost],[400000,100000,300000]);assert.equal(mystery.has_wallet,false);assert.ok(r.json.units.some(u=>u.key==='nse'&&u.lines===0));assert.equal(r.json.totals.requested,760000);
 const csv=await get(h,{format:'csv'});assert.match(csv.headers['Content-Disposition'],/FY28/);assert.match(csv.body,/"'=HYPERLINK\(""x""\)"/);assert.equal(csv.body.split('\r\n').length,5);
});

test('FY28 briefings remain reachable for programs without request lines',async()=>{
 const h=handler('school_writer'),cycle=await get(h,{});
 for(const key of ['x-mites','x-neet','lgo','sdm','gel']){
  assert.ok(cycle.json.units.some(u=>u.key===key));
  const response=await get(h,{unit:key});assert.equal(response.statusCode,200);assert.equal(response.json.lines.length,0);
 }
 assert.equal(cycle.json.totals.requested,760000,'Briefing navigation adds no financial requests');
 const saved=await put(h,{action:'notes',unit:'x-mites',section:'talking',text:'Example opening remarks',version:null});assert.equal(saved.statusCode,200);
 assert.equal((await get(h,{unit:'x-mites'})).json.notes.sections.talking.text,'Example opening remarks');
});

// ---------- QuickBase store against a fake QuickBase ----------
function fakeQB(){
 const tables={dec:'tdecisions',bri:'tbriefing',uni:'tunits',log:'tchangelog'},cfg={decisions:tables.dec,briefing:tables.bri,units:tables.uni,log:tables.log};
 const fids={},rows={};let rid=100,clock=1795000000123;const kinds={[tables.dec]:'decisions',[tables.bri]:'briefing',[tables.uni]:'units',[tables.log]:'log'};
 for(const [t,k]of Object.entries(kinds)){fids[t]=Object.fromEntries(FIELDS[k].map((l,i)=>[l,10+i]));rows[t]=[];}
 const calls=[];
 const transport={
  async rest(path,{body}={}){calls.push(path);if(path.startsWith('fields?tableId=')){const t=decodeURIComponent(path.split('=')[1]);return Object.entries(fids[t]).map(([label,id])=>({label,id}));}
   const t=body.from,conds=[...body.where.matchAll(/\{(\d+)\.EX\.'([^']*)'\}/g)];
   const data=rows[t].filter(r=>conds.every(([,id,v])=>String(r[id])===v)).map(r=>({'2':{value:new Date(r[2]).toISOString().replace(/\.\d{3}Z$/,'Z')},'3':{value:r[3]},...Object.fromEntries(Object.values(fids[t]).map(id=>[String(id),{value:r[id]??null}]))}));
   return {data,metadata:{totalRecords:data.length}};},
  async native(t,action,inner){calls.push(action);const f=Object.fromEntries([...inner.matchAll(/<field fid="(\d+)">([\s\S]*?)<\/field>/g)].map(m=>[m[1],m[2].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')]));
   const num=(k,v)=>['Request Record ID','Support %','SoE %'].some(l=>fids[t][l]==k)&&v!==''?Number(v):v;
   if(action==='API_AddRecord'){const keyId=fids[t].Key;if(keyId&&rows[t].some(r=>r[keyId]===f[keyId]))throw Object.assign(Error('dup'),{qbCode:'21'});clock+=1500;const r={3:++rid,2:clock,u:1};for(const [k,v]of Object.entries(f))r[k]=num(k,v);rows[t].push(r);return '<errcode>0</errcode>';}
   const id=Number(/<rid>(\d+)<\/rid>/.exec(inner)[1]),r=rows[t].find(x=>x[3]===id);
   if(action==='API_GetRecordInfo')return `<errcode>0</errcode><update_id>${r.u}</update_id><field><fid>2</fid><name>Date Modified</name><value>${r[2]}</value></field>`;
   if(action==='API_EditRecord'){if(String(r.u)!==/<update_id>(\d+)<\/update_id>/.exec(inner)[1])throw Object.assign(Error('conflict'),{qbCode:'31'});for(const [k,v]of Object.entries(f))r[k]=num(k,v);r.u++;clock+=1500;r[2]=clock;return '<errcode>0</errcode>';}
  },
  touch(t,key){const r=rows[t].find(x=>x[fids[t].Key]===key);r.u++;clock+=1500;r[2]=clock;}};
 return {transport,cfg,rows,fids,tables,calls};
}
test('QuickBase store: adds, edits with version + update_id checks, blocks duplicates, writes the change log',async()=>{
 const q=fakeQB(),store=createBudgetHqStore({transport:q.transport,config:q.cfg,now:()=>new Date('2026-11-18T12:00:00Z')});
 assert.equal(store.configured(),true);
 const a=await store.saveDecision('fy28','eecs','1234',{decision:'support',support_pct:50,soe_pct:40,note:'Ask Provost'},null,'oconaill','TA support');
 assert.equal(a.decision.decision,'support');assert.equal(a.decision.support_pct,50);assert.ok(a.decision.version);
 const key=q.rows[q.tables.dec][0][q.fids[q.tables.dec].Key];assert.equal(key,'FY28|eecs|1234');
 assert.deepEqual(await store.saveDecision('fy28','eecs','1234',{decision:'decline',note:''},null,'x','TA'),{conflict:true},'creating an existing row is refused');
 assert.deepEqual(await store.saveDecision('fy28','eecs','1234',{decision:'decline',note:''},'999','x','TA'),{conflict:true},'wrong version refused');
 const b=await store.saveDecision('fy28','eecs','1234',{decision:'decline',note:''},a.decision.version,'school_writer','TA support');assert.equal(b.decision.decision,'decline');
 q.transport.touch(q.tables.dec,key);assert.deepEqual(await store.saveDecision('fy28','eecs','1234',{decision:'support',support_pct:100,soe_pct:0,note:''},b.decision.version,'x','TA'),{conflict:true},'change made in QuickBase directly is not overwritten');
 const log=q.rows[q.tables.log];assert.equal(log.length,2);const lf=q.fids[q.tables.log];
 assert.equal(log[1][lf.Change],'Support 50% (SoE 40%) → Decline · note updated');assert.equal(log[1][lf['Changed By']],'school_writer');
 const u=await store.unit('fy28','eecs');assert.equal(u.decisions['1234'].decision,'decline');assert.equal(u.log.length,2);assert.equal(u.sections.talking.text,'');
 const s=await store.saveBriefing('fy28','eecs','talking','- One',null,'oconaill');assert.equal(s.section.text,'- One');
 const l=await store.saveLink('fy28','eecs','https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp',null,'oconaill');assert.match(l.link.url,/drive/);
 assert.deepEqual(Object.keys(await store.cycleDecisions('fy28')),['eecs']);
 await assert.rejects(()=>store.unit('fy28',"x'}OR{3.GT.'0"),/Invalid value/,'query injection is refused');
});
test('QuickBase store reports a missing field by name',async()=>{
 const q=fakeQB();delete q.fids[q.tables.bri].Section;const store=createBudgetHqStore({transport:q.transport,config:q.cfg});
 await assert.rejects(()=>store.unit('fy28','eecs'),/missing the field "Section"/);
});

test('pages read cycle and unit from the original address, as Netlify passes it to rewritten functions',async()=>{
 const p=createBudgetHqPageHandler(authorize(state(),'oconaill'));
 const unit=await p({httpMethod:'GET',path:'/soe-hq/budget/fy28/eecs',queryStringParameters:{}});assert.match(unit.body,/data-view="unit"/);assert.match(unit.body,/data-unit="eecs"/);
 assert.match((await p({httpMethod:'GET',path:'/soe-hq/budget/fy28',queryStringParameters:{}})).body,/data-view="cycle"/);
 assert.equal((await p({httpMethod:'GET',path:'/soe-hq/budget/2028',queryStringParameters:{}})).statusCode,404);
 assert.equal((await createBudgetHqPageHandler(authorize(state(),'unit_admin'))({httpMethod:'GET',path:'/soe-hq/budget',queryStringParameters:{}})).statusCode,403);
});

test('QuickBase store: repeated edits to the same section and line succeed (JSON API reports seconds, XML API milliseconds)',async()=>{
 const q=fakeQB(),store=createBudgetHqStore({transport:q.transport,config:q.cfg});
 let s=await store.saveBriefing('fy28','eecs','talking','first',null,'oconaill');
 for(const text of ['second','','third with more points']){const n=await store.saveBriefing('fy28','eecs','talking',text,s.section.version,'oconaill');assert.ok(!n.conflict,'edit "'+text+'" refused');s=n;}
 assert.equal((await store.unit('fy28','eecs')).sections.talking.text,'third with more points');
 let d=await store.saveDecision('fy28','eecs','7',{decision:'decline',note:''},null,'oconaill','x');
 d=await store.saveDecision('fy28','eecs','7',{decision:'support',support_pct:50,soe_pct:50,note:''},d.decision.version,'oconaill','x');assert.ok(!d.conflict);
 let l=await store.saveLink('fy28','eecs','https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp',null,'o');l=await store.saveLink('fy28','eecs','',l.link.version,'o');assert.ok(!l.conflict);
 const stale=await store.saveBriefing('fy28','eecs','talking','stale',null,'x');assert.deepEqual(stale,{conflict:true});
});
