import test from 'node:test';import assert from 'node:assert/strict';
import access from './src/access.cjs';import policy from './src/policy.cjs';import units from './src/units.cjs';import flags from './src/features.cjs';
import {createUnitCommitmentsHandler,loadCommitments,departmentScope,fiscalYear,COMMITMENTS_TABLE} from './src/unit-commitments.mjs';
import {createUnitCommitmentsPageHandler} from './src/unit-commitments-page.mjs';import {unitLanding} from './src/unit-hub.mjs';
const fields=o=>Object.fromEntries(Object.entries(o).map(([k,value])=>[k,{value}]));
const commitment=(department='AeroAstro',extra={})=>fields({3:1,2:'2026-10-28T12:00:00Z',12:department,14:'Fictional budget support',42:'Budget support',13:'Internal category',26:'Active',31:'Outgoing',6:'FY27',16:'Multi Year',11:30000,18:'PRIVATE INTERNAL NOTE',...extra});
const payment=(extra={})=>fields({3:10,2:'2026-10-28T12:00:00Z',42:1,45:'AeroAstro',25:'FY27',24:'Projected',11:'2026-11-15',12:1000,35:2000,34:null,13:'Budget Transfer',14:'JV123',44:'PRIVATE PAYMENT NOTE',10:'1111111',...extra});
const event=(unit='aeroastro',year='2027')=>({httpMethod:'GET',path:'/.netlify/functions/unit-commitments',queryStringParameters:{unit,year}});
function authorize(username,scope='aeroastro',role='admin',visible={}){const d=policy.initialPolicy();if(username&&!policy.ADMINS.includes(username))d.grants.push({username,scope,role});return (e,o)=>access.authorize(e,{...o,reader:async()=>username?{kerberos:username}:null,load:async()=>({data:d,etag:'p'}),loadFeatures:async()=>({data:{features:visible}})});}
function query(parents=[commitment()],payments=[payment()]){const calls=[];const run=async(path,body)=>{calls.push(body);const rows=body.from===COMMITMENTS_TABLE?parents:payments;return {data:rows,metadata:{totalRecords:rows.length}};};return {run,calls};}
test('exact department aliases route single units while joint and ambiguous labels are withheld',()=>{
 for(const label of ['AA','AeroAstro','Aero Astro','Aero/Astro','Aero / Astro','Aero-Astro',' AERO   ASTRO ',' Aeronautics & Astronautics '])assert.equal(departmentScope(label),'aeroastro');
 for(const label of ['Aero/Astro/Lincoln Labs','MechE/IMES','CEE/IMES','All SoE DLCs',''])assert.equal(departmentScope(label),null);
 assert.equal(departmentScope('DSME'),'dmse');assert.equal(departmentScope('iHQ'),'innovation');assert.equal(departmentScope('PPSM'),'dmse');assert.equal(departmentScope('Archaeology'),'dmse');assert.equal(fiscalYear('FY 2027'),2027);assert.equal(fiscalYear('27'),2027);assert.equal(fiscalYear('invalid'),null);
});
test('format variants are fetched through routing metadata; financial queries contain only verified unit record IDs',async()=>{
 const own=commitment(' AERO / ASTRO '),other=commitment('BE',{3:2,14:'OTHER UNIT PRIVATE TITLE'});const calls=[];
 const run=async(path,b)=>{calls.push(b);let rows;if(b.from!==COMMITMENTS_TABLE)rows=[payment()];else if(b.select.length===5)rows=[own,other];else{assert(b.where.includes("{3.EX.'1'}"));assert(!b.where.includes("{3.EX.'2'}"));rows=[own];}return {data:rows,metadata:{totalRecords:rows.length}};};
 const r=await createUnitCommitmentsHandler({authorize:authorize('reader','aeroastro','read'),query:run})(event());assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).commitments[0].unit,'aeroastro');assert(!r.body.includes('OTHER UNIT PRIVATE TITLE'));assert(!calls.some(c=>c.where.includes('AERO / ASTRO')));
});
test('unrelated or confusable names do not become an approximate unit match',async()=>{
 for(const label of ['Chemistry','EECS / CSAIL','AeroAstro / ME','АeroAstro',"AeroAstro'}OR{12.EX.'BE"]){assert.equal(departmentScope(label),null);}
 assert.equal(departmentScope('E.E.C.S.'),'eecs');assert.equal(departmentScope('Dept. of Mechanical Engineering'),'meche');assert.equal(departmentScope('Electrical Engineering and Computer Science'),'eecs');
 let financialReads=0;const run=async(path,b)=>{if(b.select.length!==5)financialReads++;return {data:[commitment('BE')],metadata:{totalRecords:1}};};const r=await createUnitCommitmentsHandler({authorize:authorize('reader','aeroastro','read'),query:run})(event());assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).commitments.length,0);assert.equal(financialReads,0);
});
test('authorization precedes source queries; limited users, other units and nonadmins requesting all are denied',async()=>{
 for(const [user,scope,role,target,code]of [[null,'aeroastro','read','aeroastro',401],['limited','aeroastro','limited_read','aeroastro',403],['junior','aeroastro','limited_write','aeroastro',403],['daf','aeroastro','admin','be',403],['daf','aeroastro','admin','all',403]]){let called=0;const h=createUnitCommitmentsHandler({authorize:authorize(user,scope,role),query:async()=>{called++;throw Error('Must not read.');}});assert.equal((await h(event(target))).statusCode,code);assert.equal(called,0);}
});
test('recipient query is exact and payment totals use funding splits once; no internal notes or source accounts leak',async()=>{
 const q=query(),h=createUnitCommitmentsHandler({authorize:authorize('reader','aeroastro','read'),query:q.run,now:()=>new Date('2026-10-28T15:00:00Z')});const r=await h(event());assert.equal(r.statusCode,200);assert.match(r.headers['Cache-Control'],/no-store/);const data=JSON.parse(r.body);assert.equal(data.payments[0].amount,3000);assert.equal(data.payments[0].type,'Budget Transfer');assert.equal(data.commitments[0].recorded_amount,30000);
 assert.deepEqual(q.calls[0].select,[3,2,12,26,31]);assert(q.calls[0].where.includes("{31.EX.'Outgoing'}"));assert(q.calls[1].where.includes("{3.EX.'1'}"));assert(q.calls[2].where.includes("{42.EX.'1'}"));assert.equal(q.calls.length,4);assert(!r.body.includes('PRIVATE'));assert(!r.body.includes('1111111'));assert(!q.calls[1].select.includes(18));assert(!q.calls[2].select.includes(44));assert(!q.calls[2].select.includes(10));
});
test('year-specific view distinguishes projected and actual, preserves zero, and never turns invalid amounts into zero',async()=>{
 const q=query([commitment()],[payment({3:10,12:'bad',35:100}),payment({3:11,24:'Actual',12:0,35:null}),payment({3:12,25:'FY28'}),payment({3:13,25:'unknown'})]);
 const r=await createUnitCommitmentsHandler({authorize:authorize('daf'),query:q.run})(event());const d=JSON.parse(r.body);assert.equal(d.payments.length,2);assert.equal(d.payments[0].amount,null);assert.equal(d.payments[1].amount,0);assert.equal(d.payments[1].status,'Actual');assert.equal(d.invalid_year_payments,1);assert(d.years.includes(2028));
});
test('wrong-unit parents, wrong-parent payments, changed lookups and closed records fail closed',async()=>{
 for(const [parents,payments]of [[[commitment()],[payment({42:2})]],[[commitment()],[payment({45:'BE'})]],[[commitment('AeroAstro',{26:'Closed'})],[]],[[commitment()],[payment({24:'Cancelled'})]]]){const q=query(parents,payments);const r=await createUnitCommitmentsHandler({authorize:authorize('daf'),query:q.run})(event());assert.equal(r.statusCode,503);assert(!r.body.includes('PRIVATE'));}
});
test('source version changes and incomplete pagination prevent a mixed-revision response',async()=>{
 let reads=0;const changed=async(path,b)=>{const rows=b.from===COMMITMENTS_TABLE?[commitment('AeroAstro',++reads===2?{2:'2026-10-28T13:00:00Z'}:{})]:[payment()];return {data:rows,metadata:{totalRecords:rows.length}};};assert.equal((await createUnitCommitmentsHandler({authorize:authorize('daf'),query:changed})(event())).statusCode,503);
 const incomplete=async()=>({data:[],metadata:{totalRecords:5}});assert.equal((await createUnitCommitmentsHandler({authorize:authorize('daf'),query:incomplete})(event())).statusCode,503);
});
test('school-wide payment requests remain below the source query-size limit',async()=>{
 const parents=Array.from({length:159},(_,i)=>commitment('AeroAstro',{3:i+1}));let requests=0;
 const run=async(path,body)=>{if(body.from===COMMITMENTS_TABLE)return {data:parents,metadata:{totalRecords:parents.length}};requests++;assert((body.where.match(/42.EX/g)||[]).length<=40);return {data:[],metadata:{totalRecords:0}};};
 const result=await loadCommitments(run,'all');assert.equal(result.commitments.length,159);assert.equal(requests,4);
});
test('SoE admins can review unassigned records; SOE Fake is genuinely empty with no real-data fallback',async()=>{
 const q=query([commitment('CEE/IMES')],[]),r=await createUnitCommitmentsHandler({authorize:authorize('oconaill'),query:q.run})(event('all'));assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).unassigned_commitments,1);
 let called=0;const fake=await createUnitCommitmentsHandler({authorize:authorize('fakedaf','soe-fake'),query:async()=>{called++;throw Error('No source for fake.');}})(event('soe-fake'));assert.equal(fake.statusCode,200);assert.equal(JSON.parse(fake.body).commitments.length,0);assert.equal(called,0);
});
test('every unit full page links to its own view; limited pages omit it and both visibility audiences enforce direct routes',async()=>{
 for(const unit of Object.keys(units.ALL_UNITS)){const full=unitLanding(unit,'full',false,'',false,false,{},false),limited=unitLanding(unit,'limited',false,'',false,false,{},false);assert(full.includes(units.unitPath(unit).replace(/\/full$/,'/commitments')));assert(!limited.includes('commitments &amp; payments'));
  assert(!unitLanding(unit,'full',false,'',false,false,{features:{commitments:false}},false).includes('commitments &amp; payments'));
 }
 for(const [path,params]of [['/units/aeroastro/commitments',{}],['/other-units/ctl/commitments',{}],['/soe-hq/commitments',{}],['/.netlify/functions/unit-commitments',{unit:'aeroastro'}],['/.netlify/functions/unit-commitments-page',{unit:'aeroastro'}]]){assert.equal(flags.featureFor({path,queryStringParameters:params}),'commitments');const denied=await authorize('daf','aeroastro','admin',{commitments:{school:true,units:false}})({path,queryStringParameters:params},{scope:'aeroastro'});assert.equal(denied.statusCode,403);}
 const hidden=await createUnitCommitmentsPageHandler(authorize('oconaill','school','admin',{commitments:{school:false,units:false}}))({httpMethod:'GET',path:'/units/aeroastro/commitments'});assert.equal(hidden.statusCode,403);
 const shown=await createUnitCommitmentsPageHandler(authorize('daf'))({httpMethod:'GET',path:'/units/aeroastro/commitments'});assert.equal(shown.statusCode,200);assert.match(shown.body,/data-commitment-unit="aeroastro"/);assert.equal((await createUnitCommitmentsPageHandler(authorize(null))({httpMethod:'GET',path:'/units/aeroastro/commitments'})).statusCode,302);
});
