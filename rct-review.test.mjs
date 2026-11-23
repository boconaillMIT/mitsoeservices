import test from 'node:test';import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {emptyReview,validateReview,fundingSummary,commitmentView,decisionState,centralThirds,fundingReview,fundingTotal,requestedTotal,sortProposals,departmentInfo} from './src/rct-model.mjs';
import {createRctHandler} from './src/rct-review.mjs';import {createRctStore} from './src/rct-store.mjs';
import {exportReviews} from './src/rct-export.mjs';import {dropboxLink,loadDropboxTemplate} from './src/rct-dropbox.mjs';import {createHash} from 'node:crypto';
import {createRctVersions,validatePdf,MAX_PDF_BYTES} from './src/rct-versions.mjs';
import {createAdminHandler} from './src/admin-api.mjs';
import {createDashboardHandler} from './src/dashboard.mjs';
import {createMyUnitHandler} from './src/my-unit.mjs';
import access from './src/access.cjs';import policy from './src/policy.cjs';import {mainNavigation} from './src/navigation.cjs';
const source={order:0,pi:'Example, Faculty',area:'Example School',department:'Example department',duration:'6 months',requested:120,budgetTotal:120,prior:'No',budgetDifference:0,sourceNotes:'Example source note',title:'Example project',proposalUrl:'https://www.dropbox.com/scl/fo/example/token/example.pdf?rlkey=test&dl=0',workbookUrl:'https://www.dropbox.com/scl/fo/example/token/example.xlsx?rlkey=test&dl=0',templateSha:'def'};
const row=()=>({id:'FY27-RCT2|example',source,review:emptyReview(),revision:'v1',updatedBy:'',updatedAt:null});
const event=(action='',method='GET',body)=>({path:'/soe-hq/rct-review'+(action?'/'+action:''),httpMethod:method,headers:{origin:'https://example.test','content-type':'application/json'},queryStringParameters:{},body:body&&JSON.stringify(body)});
const auth=async()=>({user:{},kerberos:'reviewer',canWrite:true,schoolAccess:true});
test('RCT money inputs preserve blanks and zero and reject invalid values',()=>{
 assert.deepEqual(validateReview(emptyReview()),emptyReview());assert.equal(validateReview({...emptyReview(),award:0}).award,0);
 for(const award of [-1,NaN,Infinity,'12',0.001,100000001])assert.throws(()=>validateReview({...emptyReview(),award}));
 assert.throws(()=>validateReview({...emptyReview(),notes:'x'.repeat(15001)}));assert.throws(()=>validateReview({...emptyReview(),unexpected:true}));
 assert.deepEqual(fundingSummary(emptyReview()),{assigned:null,local:null,central:null,unallocated:null,complete:false});
 const r={...emptyReview(),award:90,school:15,department:10,pi:5,provost:30,evpt:30,vpr:999,decision:'Support'};assert.deepEqual(fundingSummary(r),{assigned:90,local:30,central:60,unallocated:0,complete:true});
 assert.equal(fundingSummary({...r,award:105}).complete,false);assert.equal(fundingSummary({...emptyReview(),award:0,decision:'Decline'}).complete,true);
});
test('RCT commitment views include only support decisions and reconcile every funding source',()=>{
 const r=(id,area,department,review)=>({...row(),id,source:{...source,pi:id,area,department},review:{...emptyReview(),...review}});
 const rows=[r('A','School A','Department A',{decision:'Support',award:120,school:20,department:10,pi:10,provost:1,evpt:1,vpr:999}),r('B','School A','Department B',{decision:'Partial support',award:60,school:10,department:5,pi:5,provost:1,evpt:1,vpr:999}),r('C','Joint schools','Joint departments',{decision:'Discuss',award:1000,school:900}),r('D','School B','Department D',{decision:'Decline',award:0})];
 const view=commitmentView(rows);assert.equal(view.selected,2);assert.equal(view.excluded,2);for(const [key,value]of Object.entries({award:180,school:30,department:15,pi:15,provost:60,evpt:60,assigned:180,unallocated:0}))assert.equal(view.total.amounts[key].total,value,key);
 const schools=commitmentView(rows,{groupBy:'school'});assert.equal(schools.rows.length,1);assert.equal(schools.rows[0].label,'School A');assert.equal(schools.rows[0].amounts.award.total,180);
 const departments=commitmentView(rows,{groupBy:'department'});assert.equal(departments.rows.length,2);assert.equal(departments.rows.reduce((n,g)=>n+g.amounts.award.total,0),180);
 assert.equal(commitmentView(rows,{scope:'all',groupBy:'school'}).selected,4);assert.equal(commitmentView(rows,{scope:'undecided'}).rows[0].label,'C');assert.equal(commitmentView(rows,{scope:'declined'}).total.amounts.award.total,0);
 for(const d of ['','Discuss','Do not support','support with conditions'])assert.equal(decisionState(d),'undecided');assert.equal(decisionState(' Partial support '),'supported');assert.equal(fundingSummary(rows[2].review).complete,false);
 assert.throws(()=>commitmentView(rows,{scope:'bad'}));
});
test('RCT commitment totals retain missing versus zero and never double-count joint affiliations',()=>{
 const rows=[{...row(),id:'A',source:{...source,area:'Joint A / B'},review:{...emptyReview(),decision:'Support',award:0,school:0}},{...row(),id:'B',source:{...source,area:'Joint A / B'},review:{...emptyReview(),decision:'Support'}}];
 const view=commitmentView(rows,{groupBy:'school'});assert.equal(view.rows.length,1);assert.equal(view.total.count,2);assert.deepEqual(view.total.amounts.school,{total:0,entered:1,count:2});assert.equal(Object.hasOwn(view.total.amounts,'vpr'),false);assert.deepEqual(view.total.amounts.department,{total:null,entered:0,count:2});assert.deepEqual(view.total.amounts.award,{total:0,entered:1,count:2});
 const none=commitmentView(rows.map(r=>({...r,review:{...r.review,decision:''}})));assert.equal(none.selected,0);assert.equal(none.total.amounts.award.total,null);
});
test('RCT independent permissions protect every route',async()=>{
 const data=policy.initialPolicy();for(const [username,scope,role]of [['unit_person','aeroastro','admin'],['hq_limited','school','limited_read'],['hq_reader','rct','read'],['hq_writer','rct','write'],['finance_only','school','write']])data.grants.push({username,scope,role});
 for(const username of ['unit_person','hq_limited','hq_reader','hq_writer','finance_only']){
  let touched=0;const authorize=(e,o)=>access.authorize(e,{...o,reader:async()=>({kerberos:username}),load:async()=>({data,etag:'x'}),loadFeatures:async()=>({data:{features:{}}})});
  const store={list:async()=>{touched++;return [row()];},save:async()=>{touched++;return {row:row()};}},handler=createRctHandler({authorize,store,template:async()=>Buffer.from('file'),exporter:()=>Buffer.from('xlsx'),versions:{list:async()=>[],download:async()=>null}});
  for(const action of ['','data','proposal','source','export','versions']){const e=event(action);e.queryStringParameters.id=row().id;const r=await handler(e);assert.equal(r.statusCode,['hq_reader','hq_writer'].includes(username)?['proposal','source'].includes(action)?302:200:403);}
  if(['unit_person','hq_limited','finance_only'].includes(username))assert.equal(touched,0);
  const saved=await handler(event('data','POST',{id:row().id,revision:'v1',review:emptyReview()}));assert.equal(saved.statusCode,username==='hq_writer'?200:403);
 }
 assert.ok(mainNavigation({schoolAccess:false,visibility:{rct:true}}).includes('/soe-hq/rct-review'));assert.ok(!mainNavigation().includes('/soe-hq/rct-review'));
});
test('RCT anonymous routes never open storage and page redirects to MIT sign-in',async()=>{
 const handler=createRctHandler({authorize:async()=>({statusCode:401,body:'Sign in'}),store:{list(){throw Error('Must not read');}}});
 assert.equal((await handler(event())).statusCode,302);for(const action of ['data','proposal','source','export'])assert.equal((await handler(event(action))).statusCode,401);
});
test('RCT writes enforce same-origin JSON, bounded fields and optimistic revision',async()=>{
 let saves=0;const handler=createRctHandler({authorize:auth,store:{save:async()=>{saves++;return {conflict:true};}}}),e=event('data','POST',{id:row().id,revision:'v1',review:emptyReview()});
 assert.equal((await handler({...e,headers:{...e.headers,origin:'https://foreign.test'}})).statusCode,403);
 assert.equal((await handler({...e,headers:{...e.headers,'content-type':'text/plain'}})).statusCode,403);assert.equal(saves,0);
 assert.equal((await handler({...e,body:'{bad'})).statusCode,400);assert.equal((await handler({...e,body:'x'.repeat(70001)})).statusCode,413);
 assert.equal((await handler(event('data','POST',{id:"bad'OR'1",revision:'v1',review:emptyReview()}))).statusCode,400);
 assert.equal((await handler(e)).statusCode,409);assert.equal(saves,1);
 const direct=await handler({...event('','DELETE'),path:'/.netlify/functions/rct-review',queryStringParameters:{action:'data'}});assert.equal(direct.statusCode,405);
});
test('RCT Dropbox redirects and Excel export require authorization and stay private',async()=>{
 const loaded=[],handler=createRctHandler({authorize:auth,store:{list:async()=>[row()]},template:async(source)=>{loaded.push(source);return Buffer.from('template');},exporter:()=>Buffer.from('excel')});
 const e=event('proposal');e.queryStringParameters.id=row().id;const pdf=await handler(e);assert.equal(pdf.statusCode,302);assert.equal(pdf.headers.Location,source.proposalUrl);assert.match(pdf.headers['Cache-Control'],/no-store/);assert.equal(loaded.length,0);
 e.queryStringParameters.id='../unknown';assert.equal((await handler(e)).statusCode,404);
 const original=await handler(event('source'));assert.equal(original.statusCode,302);assert.equal(original.headers.Location,source.workbookUrl);
 const xlsx=await handler(event('export'));assert.equal(xlsx.statusCode,200);assert.match(xlsx.headers['Content-Disposition'],/xlsx/);assert.match(xlsx.headers['Cache-Control'],/private/);assert.equal(loaded.length,1);
 const unsafe=createRctHandler({authorize:auth,store:{list:async()=>[{...row(),source:{...source,proposalUrl:'https://evil.test/file.pdf'}}]}});assert.equal((await unsafe({...event('proposal'),queryStringParameters:{id:row().id}})).statusCode,503);
});
test('RCT workbook download restricts redirects, sizes and the imported fingerprint',async()=>{
 const bytes=Buffer.from('PK example workbook'),sha=createHash('sha256').update(bytes).digest('hex'),s={...source,templateSha:sha},calls=[];
 const downloaded=await loadDropboxTemplate(s,{fetcher:async(url)=>{calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:'https://dl.dropboxusercontent.com/example.xlsx'}}):new Response(bytes);}});assert.deepEqual(downloaded,bytes);assert.match(calls[0],/dl=1/);
 for(const url of ['http://www.dropbox.com/scl/fo/a/b/file.pdf','https://evil.test/file.pdf','https://www.dropbox.com/scl/fo/a/b/file.xlsx'])assert.throws(()=>dropboxLink(url,'.pdf'));
 await assert.rejects(()=>loadDropboxTemplate(s,{fetcher:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}));
 await assert.rejects(()=>loadDropboxTemplate(s,{maxBytes:2,fetcher:async()=>new Response(bytes)}));
 await assert.rejects(()=>loadDropboxTemplate(s,{fetcher:async()=>new Response(Buffer.from('PK changed'))}));
});
function transportFixture(initial=emptyReview()){const labels=['Key','Round','Source JSON','Review JSON','Revision','Updated By','Updated At'],fields=labels.map((label,i)=>({label,id:i+10}));let revision='v1',editCalls=0;return {fields,get editCalls(){return editCalls;},change:()=>{revision='other';},transport:{rest:async(path)=>path.startsWith('fields')?fields:{data:[{'3':{value:8},'10':{value:row().id},'11':{value:'FY27-RCT2'},'12':{value:JSON.stringify(source)},'13':{value:JSON.stringify(initial)},'14':{value:revision},'15':{value:''},'16':{value:null}}],metadata:{totalRecords:1}},native:async(table,action,body)=>{if(action==='API_GetRecordInfo')return `<qdbapi><update_id>u1</update_id><field><fid>14</fid><value>${revision}</value></field></qdbapi>`;assert.match(body,/<update_id>u1<\/update_id>/);editCalls++;return '<qdbapi><errcode>0</errcode></qdbapi>';}}};}
test('RCT QuickBase revisions reject stale clients and use atomic update_id',async()=>{
 const f=transportFixture(),store=createRctStore({transport:f.transport,table:'exampletable',uuid:()=> 'v2',now:()=>new Date('2026-01-01')});
 assert.equal((await store.save(row().id,emptyReview(),'old','reviewer')).conflict,true);assert.equal(f.editCalls,0);
 const saved=await store.save(row().id,emptyReview(),'v1','reviewer');assert.equal(saved.row.revision,'v2');assert.equal(f.editCalls,1);
 const other=transportFixture(),original=other.transport.native;other.transport.native=async(...args)=>{if(args[1]==='API_GetRecordInfo')other.change();return original(...args);};assert.equal((await createRctStore({transport:other.transport,table:'exampletable'}).save(row().id,emptyReview(),'v1','reviewer')).conflict,true);assert.equal(other.editCalls,0);
});
function template(){const cells=(r)=>'ABCDEFGHIJKLMNOPQRSTUV'.split('').map(c=>`<c r="${c}${r}" s="2"/>`).join('');const data=`<sheetData><row r="3">${cells(3)}</row><row r="4">${cells(4)}</row><row r="5"><c r="B5" s="2"><v>1</v></c><c r="E5" s="2"><v/></c><c r="H5" s="2"><v>1</v></c></row><row r="7">${cells(7)}</row><row r="8">${cells(8)}</row><row r="18">${cells(18)}</row></sheetData>`;return zipSync(Object.fromEntries(Object.entries({'xl/worksheets/sheet1.xml':`<worksheet><dimension ref="A2:V18"/>${data}</worksheet>`,'xl/tables/table1.xml':'<table ref="A7:V17"><calculatedColumnFormula>[2]EXTERNAL</calculatedColumnFormula></table>','xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><externalReferences><externalReference/></externalReferences><calcPr/></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Type="http://example/externalLink" Target="x"/></Relationships>','[Content_Types].xml':'<Types><Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="x"/></Types>','xl/externalLinks/externalLink1.xml':'external','xl/calcChain.xml':'chain','xl/styles.xml':'unchanged style'}).map(([k,v])=>[k,strToU8(v)])));}

test('revised requests drive current totals and central thirds while original requests and awards stay independent',()=>{
 const revised={...emptyReview(),requested:60};assert.equal(requestedTotal(revised,source),60);assert.equal(fundingTotal(revised,source),60);assert.equal(fundingReview(revised,source).provost,20);assert.equal(source.requested,120);
 assert.equal(fundingTotal({...revised,award:90},source),90);assert.equal(fundingReview({...revised,award:90},source).evpt,30);assert.equal(requestedTotal({...revised,requested:0},source),0);assert.equal(requestedTotal({...revised,requested:null},source),120);
 assert.equal(commitmentView([{...row(),review:revised}],{scope:'all'}).total.amounts.requested.total,60);
 for(const requested of [-1,NaN,Infinity,'60',0.001,100000001])assert.throws(()=>validateReview({...revised,requested}));
});
test('requested-amount saves preserve source and notes, stamp authenticated history, and protect older clients',async()=>{
 const original={...emptyReview(),notes:'Keep shared note',requested:60,requestedHistory:[{amount:60,by:'earlier_editor',at:'2026-01-01T12:00:00Z'}]},f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable',now:()=>new Date('2026-01-02T12:00:00Z')});
 const saved=await store.save(row().id,{...original,requested:75,requestedHistory:[{amount:1,by:'forged',at:'2026-01-01'}]},'v1','actual_editor');assert.equal(saved.row.source.requested,120);assert.equal(saved.row.review.notes,original.notes);assert.equal(saved.row.review.requested,75);assert.deepEqual(saved.row.review.requestedHistory,[...original.requestedHistory,{amount:75,by:'actual_editor',at:'2026-01-02T12:00:00.000Z'}]);
 const {requested,requestedHistory,...older}=original;const kept=await store.save(row().id,older,'v1','actual_editor');assert.equal(kept.row.review.requested,60);assert.deepEqual(kept.row.review.requestedHistory,original.requestedHistory);
 const restored=await store.save(row().id,{...original,requested:120},'v1','actual_editor');assert.equal(restored.row.review.requested,null);assert.equal(restored.row.review.requestedHistory.at(-1).amount,null);assert.equal(restored.row.source.requested,120);
});
test('Excel uses revised requests and retains original request provenance alongside existing source notes',()=>{
 const review={...emptyReview(),requested:60,requestedHistory:[{amount:60,by:'example_editor',at:'2026-01-01T12:00:00Z'}]},zip=unzipSync(exportReviews(template(),[{...row(),review}])),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<c r="E8"[^>]*><v>60<\/v>/);assert.match(sheet,/<c r="B5"[^>]*><f>SUM\(E8:E8\)<\/f><v>60<\/v>/);assert.match(sheet,/Original requested amount/);assert.match(sheet,/example_editor/);assert.match(sheet,/Example source note/);assert.equal(source.requested,120);
});
test('revised requests automatically update blank or matching awards and their central contributions',async()=>{
 for(const award of [null,120]){const original={...emptyReview(),award},f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable'}),saved=await store.save(row().id,{...original,requested:90},'v1','editor');assert.equal(saved.row.review.award,90);assert.equal(saved.row.review.awardMode,'follow');assert.equal(saved.row.review.provost,30);assert.equal(saved.row.review.evpt,30);assert.equal(saved.row.source.requested,120);}
});
test('custom awards remain custom even when a revised request temporarily matches them, and can resume following',async()=>{
 const save=async(original,change)=>{const f=transportFixture(original);return (await createRctStore({transport:f.transport,table:'exampletable'}).save(row().id,{...original,...change},'v1','editor')).row.review;};
 let review=await save({...emptyReview(),award:80},{requested:100});assert.equal(review.award,80);assert.equal(review.awardMode,'custom');
 review=await save(review,{requested:80});assert.equal(review.awardMode,'custom');review=await save(review,{requested:70});assert.equal(review.award,80);assert.equal(review.awardMode,'custom');
 review=await save(review,{awardMode:'follow',award:70});assert.equal(review.award,70);assert.equal(review.awardMode,'follow');review=await save(review,{requested:60});assert.equal(review.award,60);
 const zero=await save({...emptyReview(),award:0,decision:'Decline'},{requested:90});assert.equal(zero.award,0);assert.equal(zero.awardMode,'custom');
});
test('older clients preserve custom mode but deliberate different award edits stop automatic following',async()=>{
 const custom={...emptyReview(),award:75,awardMode:'custom'},f=transportFixture(custom),store=createRctStore({transport:f.transport,table:'exampletable'});const {awardMode,...older}=custom;const saved=await store.save(row().id,{...older,requested:75},'v1','editor');assert.equal(saved.row.review.awardMode,'custom');
 const following={...emptyReview(),award:120,awardMode:'follow'},other=transportFixture(following),changed=await createRctStore({transport:other.transport,table:'exampletable'}).save(row().id,{...following,award:70},'v1','editor');assert.equal(changed.row.review.award,70);assert.equal(changed.row.review.awardMode,'custom');
 assert.throws(()=>validateReview({...emptyReview(),awardMode:'invalid'}));
});
test('RCT Excel maps all 11 proposals, preserves styles, removes links and recalculates local formulas',()=>{
 const rows=Array.from({length:11},(_,i)=>({...row(),id:'FY27-RCT2|fake-'+i,source:{...source,pi:'Example '+String(i).padStart(2,'0'),order:i},review:{...emptyReview(),award:i===0?0:100,school:i===0?null:40,provost:i===0?null:60,decision:'Support',notes:'=NOT_A_FORMULA & <text>'}}));
 const zip=unzipSync(exportReviews(template(),rows)),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<dimension ref="A2:Z19"/);assert.match(sheet,/<c r="B18"[^>]*t="inlineStr">[\s\S]*?Example 10/);assert.match(sheet,/<c r="G8"[^>]*><v>0<\/v>/);assert.match(sheet,/<c r="H8"[^>]*><f>ROUND\(IF\(G8="",E8,G8\)\/3,2\)<\/f><v>0<\/v>/);
 assert.match(sheet,/IF\(G18="",E18,G18\)-SUM\(H18:L18,W18\)/);assert.match(sheet,/Calculation basis/);assert.doesNotMatch(sheet,/VPR/);assert.match(sheet,/COUNTA\(B8:B18\)/);assert.match(sheet,/=NOT_A_FORMULA &amp; &lt;text&gt;/);
 assert.match(strFromU8(zip['xl/workbook.xml']),/name="Review details"/);assert.match(strFromU8(zip['xl/worksheets/rct-review-details.xml']),/Overall priority/);assert.match(strFromU8(zip['xl/worksheets/rct-review-details.xml']),/Need priority \(1 highest, 5 lowest\)/);assert.equal(strFromU8(zip['xl/styles.xml']),'unchanged style');assert.ok(!Object.keys(zip).some(k=>k.includes('externalLinks')||k.includes('calcChain')));assert.ok(!strFromU8(zip['xl/tables/table1.xml']).includes('calculatedColumnFormula'));assert.match(strFromU8(zip['xl/tables/table1.xml']),/A7:Z18/);
});
test.before(()=>{process.env.APP_ORIGIN='https://example.test';});

test('RCT managers manage only RCT; independent grants never expose finance pages or grants',async()=>{
 const data=policy.initialPolicy();for(const role of ['read','write','admin'])data.grants.push({username:'rct_'+role,scope:'rct',role});
 for(const role of ['read','write','admin']){
  const username='rct_'+role,authorize=(e,o)=>access.authorize(e,{...o,reader:async()=>({kerberos:username}),load:async()=>({data,etag:'x'}),loadFeatures:async()=>({data:{features:{}}})});
  const result=await authorize({}, {scope:'rct'});assert.equal(result.schoolAccess,false);assert.equal(result.canManage,role==='admin');assert.equal(result.navigation.rct,true);
  for(const scope of Object.keys(policy.SCOPES).filter(s=>s!=='rct'))assert.equal((await authorize({}, {scope})).statusCode,403,scope);
  const admin=await createAdminHandler({authorize})(new Request('https://example.test/.netlify/functions/admin-access'));assert.equal(admin.status,role==='admin'?200:403);if(role==='admin'){const view=await admin.json();assert.deepEqual(Object.keys(view.scopes),['rct']);assert.deepEqual(view.roleLabels.rct,{read:'Read',write:'Write',admin:'Manager'});assert(view.grants.every(g=>g.scope==='rct'));assert(view.audit.every(a=>a.scope==='rct'));}
  const home=await createDashboardHandler(authorize)({httpMethod:'GET'});assert.equal(home.statusCode,200);assert.match(home.body,/Open RCT review/);assert(!home.body.includes('href="/soe-hq/budget"'));assert(!home.body.includes('href="/soe-wallet"'));
  assert.equal((await createMyUnitHandler(authorize)({httpMethod:'GET'})).headers.Location,'/soe-hq/rct-review');
 }
 assert.deepEqual(policy.managedScopes(data,'rct_admin'),['rct']);assert.throws(()=>policy.validatePolicy({...data,grants:[...data.grants,{username:'bad',scope:'rct',role:'limited_write'}]}));
});
test('reviewer grades, optional ranks and unknown grad flags validate without altering existing notes',()=>{
 const old={award:null,provost:100,evpt:null,school:null,department:null,pi:null,vpr:null,decision:'',notes:' Original note\n '};const r=validateReview(old);assert.equal(r.notes,old.notes);assert.equal(r.autoCentral,true);assert.equal(r.gradStudents,null);assert.equal(r.reviewers.length,6);
 for(const priority of [0,-1,1.5,1001,'1'])assert.throws(()=>validateReview({...r,priority}));
 for(const grade of ['0','6','A','1.5'])assert.throws(()=>validateReview({...r,reviewers:r.reviewers.map((v,i)=>i? v:{...v,grade})}));
 assert.equal(validateReview({...r,priority:1,gradStudents:false}).gradStudents,false);
 const reviewers=r.reviewers.map((v,i)=>i===4?{name:'Example reviewer',grade:'5',comments:'Example comment'}:v);assert.equal(validateReview({...r,reviewers}).reviewers[4].grade,'5');
 assert.throws(()=>validateReview({...r,reviewers:reviewers.map((v,i)=>i===4?{...v,name:''}:v)}));
});
test('central thirds are mandatory; local blanks and nonfatal funding mismatches are preserved',async()=>{
 assert.deepEqual(centralThirds(100),{provost:33.33,evpt:33.33,local:33.34,schoolTarget:16.67});
 const f=transportFixture(),s=createRctStore({transport:f.transport,table:'exampletable'});const saved=await s.save(row().id,{...emptyReview(),award:100},'v1','reviewer');assert.equal(saved.row.review.provost,33.33);assert.equal(saved.row.review.evpt,33.33);assert.equal(saved.row.review.school,null);
 const manual=await s.save(row().id,{...emptyReview(),award:100,provost:20,evpt:10,autoCentral:false},'v1','reviewer');assert.equal(manual.row.review.provost,33.33);assert.equal(manual.row.review.evpt,33.33);assert.equal(manual.row.review.school,null);assert.equal(fundingSummary(manual.row.review,source).unallocated,33.34);
 const over=await s.save(row().id,{...emptyReview(),award:100,school:100},'v1','reviewer');assert.equal(over.row.review.school,100);assert.equal(fundingSummary(over.row.review,source).unallocated,-66.66);
 const fallback=await s.save(row().id,{...emptyReview()},'v1','reviewer');assert.equal(fallback.row.review.award,null);assert.equal(fallback.row.review.provost,40);assert.equal(fallback.row.review.evpt,40);
 const zero=await s.save(row().id,{...emptyReview(),award:0},'v1','reviewer');assert.equal(zero.row.review.provost,0);assert.equal(zero.row.review.evpt,0);
});
test('edited shared and reviewer comments retain previous text; stale clients cannot delete new fields',async()=>{
 const original={...emptyReview(),notes:'Original shared note',priority:2,gradStudents:true};original.reviewers[0].comments='Original reviewer comment';original.reviewers[0].grade='4';
 const f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable'});
 const legacy={...Object.fromEntries(MONEY_FIXTURE.map(k=>[k,null])),decision:'',notes:'Updated shared note'};
 const updated=await store.save(row().id,legacy,'v1','reviewer');assert.equal(updated.row.review.reviewers[0].comments,'Original reviewer comment');assert.equal(updated.row.review.priority,2);assert.equal(updated.row.review.gradStudents,true);assert.equal(updated.row.review.notesHistory[0].text,'Original shared note');
 const changed=await store.save(row().id,{...original,reviewers:original.reviewers.map((v,i)=>i? v:{...v,comments:'New comment'}),notesHistory:[]},'v1','reviewer');assert(changed.row.review.notesHistory.some(n=>n.text==='Hammond: Original reviewer comment'));
});
const MONEY_FIXTURE=['award','provost','evpt','school','department','pi','vpr'];
test('older invitation pages cannot remove reviewers they could not display',async()=>{
 const original={...emptyReview(),assignments:['hammond','email-example']};let f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable'});const old=await store.save(row().id,{...original,assignments:['hamsa']},'v1','example_editor');assert.deepEqual(old.row.review.assignments,['hamsa','email-example']);
 f=transportFixture(original);store=createRctStore({transport:f.transport,table:'exampletable'});const current=await store.save(row().id,{...original,assignments:['hamsa']},'v1','example_editor',{knownReviewerKeys:['hammond','hamsa','email-example']});assert.deepEqual(current.row.review.assignments,['hamsa']);
});
test('legacy clients preserve extra reviewer scores and attribution, and exports expand safely past column Z',async()=>{
 const original=emptyReview();original.reviewers.push({reviewerKey:'email-example',name:'Example Additional Reviewer',grade:'2',comments:'Retain the additional comment'});const validated=validateReview(original),f=transportFixture(validated),store=createRctStore({transport:f.transport,table:'exampletable'}),oldClient={...validated,reviewers:validated.reviewers.slice(0,6)};const saved=await store.save(row().id,oldClient,'v1','example_editor');assert.equal(saved.row.review.reviewers.length,7);assert.deepEqual(saved.row.review.reviewers[6],validated.reviewers[6]);assert.equal(saved.row.review.commentStamps.reviewers.length,7);
 const output=unzipSync(exportReviews(template(),[{...row(),review:saved.row.review}])),details=strFromU8(output['xl/worksheets/rct-review-details.xml']);assert.match(details,/Reviewer 7/);assert.match(details,/Example Additional Reviewer/);assert.match(details,/Retain the additional comment/);assert.match(details,/A1:AA2/);
});
test('legacy review saves preserve assignments set by an inviter',async()=>{
 const original={...emptyReview(),assignments:['hammond','hamsa']},f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable'});const {assignments,...oldClient}=original;const saved=await store.save(row().id,oldClient,'v1','reviewer');assert.deepEqual(saved.row.review.assignments,assignments);
});
test('clearing a reviewer name and score preserves comments and their earlier attribution',async()=>{
 const original=emptyReview();original.reviewers[0]={name:'Hammond',grade:'2',comments:'Retain this reviewer comment'};
 const f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable'});
 const cleared={...original,reviewers:original.reviewers.map((v,i)=>i?v:{...v,name:'',grade:''})};
 const saved=await store.save(row().id,cleared,'v1','example_editor');
 assert.equal(saved.row.review.reviewers[0].name,'');assert.equal(saved.row.review.reviewers[0].grade,'');assert.equal(saved.row.review.reviewers[0].comments,'Retain this reviewer comment');assert(saved.row.review.notesHistory.some(n=>n.text==='Hammond: Retain this reviewer comment'));
});
test('department ordering uses MIT course numbers and keeps joint proposals together',()=>{
 const names=['Nuclear Science & Engineering','Chemical Engineering','Mechanical Engineering','EECS','Aeronautics and Astronautics','Civil and Environmental Engineering','Materials Science and Engineering','Civil and Environmental Engineering and Architecture'];
 const sorted=sortProposals(names.map((department,i)=>({...row(),id:String(i),source:{...source,department}})));assert.deepEqual(sorted.map(r=>departmentInfo(r.source).number),[1,1,2,3,6,10,16,22]);assert.equal(sorted.length,names.length);assert.match(departmentInfo(sorted[1].source).label,/Course 1 \/ 4/);
});
test('PDF versions are append-only, validate content, and downloads use the fixed authenticated endpoint',async()=>{
 const id='00000000-0000-4000-8000-000000000001',file={id:row().id,filename:'example.pdf',content:Buffer.from('%PDF-1.7 example').toString('base64')};assert.equal(validatePdf(file).length,16);
 for(const patch of [{filename:'../example.pdf'},{filename:'example.html'},{content:Buffer.from('<html>').toString('base64')},{content:'x'.repeat(MAX_PDF_BYTES*2)}])assert.throws(()=>validatePdf({...file,...patch}));
 const labels=['Key','Proposal Key','File','Uploaded By','Uploaded At'],fields=labels.map((label,i)=>({label,id:10+i}));let uploads=0;
 const transport={rest:async(path,options)=>{if(path.startsWith('fields'))return fields;if(path==='records'){uploads++;assert.equal(options.body.data[0]['12'].value.fileName,'example.pdf');assert.equal(options.body.data[0]['11'].value,row().id);return {metadata:{createdRecordIds:[8]}};}return {data:[{'3':{value:8},'10':{value:id},'12':{value:{versions:[{versionNumber:1,fileName:'example.pdf'}]}},'13':{value:'reviewer'},'14':{value:'2026-01-01'}}],metadata:{totalRecords:1}};}};
 let fetched;const versions=createRctVersions({transport,table:'exampletable',uuid:()=>id,token:()=> 'fake-token',fetcher:async(url,opts)=>{fetched=url;assert.match(opts.headers.Authorization,/fake-token/);return new Response(file.content);}});
 await versions.upload(file,'reviewer');await versions.upload(file,'reviewer');assert.equal(uploads,2);const downloaded=await versions.download(row().id,id);assert.equal(downloaded.bytes.toString(),'%PDF-1.7 example');assert.equal(fetched,'https://api.quickbase.com/v1/files/exampletable/8/12/1');assert.equal(await versions.download(row().id,'missing'),null);
});
test('file routes require RCT access; final versions must belong to the selected proposal',async()=>{
 const id='00000000-0000-4000-8000-000000000001';let uploads=0,saves=0;const versions={list:async()=>[{id,filename:'example.pdf',rid:'8'}],upload:async()=>{uploads++;return {id};},download:async()=>({filename:'example.pdf',bytes:Buffer.from('%PDF-1.7 example')})},store={list:async()=>[row()],save:async()=>{saves++;return {row:row()};}};
 const h=createRctHandler({authorize:auth,store,versions});const get={...event('versions'),queryStringParameters:{id:row().id}};assert.equal((await h(get)).statusCode,200);assert(!JSON.parse((await h(get)).body).versions[0].rid);
 assert.equal((await h({...get,path:'/soe-hq/rct-review/file',queryStringParameters:{id:row().id,version:id}})).statusCode,200);
 const file={id:row().id,filename:'example.pdf',content:Buffer.from('%PDF-1.7 example').toString('base64')};assert.equal((await h(event('versions','POST',file))).statusCode,201);assert.equal(uploads,1);
 const bad=await h(event('data','POST',{id:row().id,revision:'v1',review:{...emptyReview(),finalVersion:'00000000-0000-4000-8000-000000000002'}}));assert.equal(bad.statusCode,400);assert.equal(saves,0);
 const denied=createRctHandler({authorize:async()=>({statusCode:403}),store:{list(){throw Error('Must not open');}},versions});for(const action of ['versions','file'])assert.equal((await denied(event(action))).statusCode,403);
});

test('API calculates thirds immediately from the requested total without creating an award or local amounts',async()=>{
 const handler=createRctHandler({authorize:auth,store:{list:async()=>[row()]}});const result=JSON.parse((await handler(event('data'))).body).records[0];
 assert.equal(result.review.award,null);assert.equal(result.review.provost,40);assert.equal(result.review.evpt,40);for(const key of ['school','department','pi'])assert.equal(result.review[key],null);assert.equal(result.review.notes,'');
 assert.equal(fundingTotal(result.review,result.source),120);assert.equal(fundingSummary(result.review,result.source).unallocated,40);
});
test('new saves preserve retired VPR values for history but exclude them from assigned funding',async()=>{
 const initial={...emptyReview(),vpr:999,notes:'Keep this note'},fixture=transportFixture(initial),store=createRctStore({transport:fixture.transport,table:'exampletable'});
 const saved=await store.save(row().id,{...emptyReview(),vpr:0,award:120,school:40,notes:'Keep this note'},'v1','reviewer');assert.equal(saved.row.review.vpr,999);assert.equal(saved.row.review.notes,'Keep this note');assert.equal(fundingSummary(saved.row.review,source).assigned,120);assert.equal(fundingSummary(saved.row.review,source).complete,false);
});

test('named local funders preserve old reviews, validate names and include Other in totals',()=>{
 const old=emptyReview();delete old.other;delete old.fundingLabels;const migrated=validateReview(old);assert.equal(migrated.other,null);assert.deepEqual(migrated.fundingLabels,{department:'Department',pi:'PI',other:'Other'});
 const r=validateReview({...emptyReview(),award:120,school:10,department:10,pi:10,other:10,fundingLabels:{department:' CEE ',pi:'Architecture',other:'Partner'},decision:'Support'});
 assert.equal(r.fundingLabels.department,'CEE');assert.equal(fundingSummary(fundingReview(r,source),source).assigned,120);assert.equal(fundingSummary(r,source).local,40);
 for(const labels of [{department:''},{school:'Different'},{department:'x'.repeat(61)},{department:'a\nb'},[]])assert.throws(()=>validateReview({...r,fundingLabels:labels}));
});
test('named funding rollups follow the contributor across different local slots',()=>{
 const a={...row(),review:{...emptyReview(),award:120,decision:'Support',department:10,other:0,fundingLabels:{department:'CEE',pi:'PI',other:'Partner'}}};
 const b={...row(),id:'FY27-RCT2|second',review:{...emptyReview(),award:120,decision:'Support',pi:20,fundingLabels:{department:'Department',pi:'cee',other:'Other'}}};
 const result=commitmentView([a,b]);assert.equal(result.total.amounts['contributor:cee'].total,30);assert.equal(result.total.amounts['contributor:cee'].entered,2);assert.equal(result.total.amounts['contributor:partner'].total,0);assert.equal(result.localFunders.filter(f=>f.key==='contributor:cee').length,1);
});
test('clients without new funding fields preserve saved names and Other amounts',async()=>{
 const initial={...emptyReview(),other:7,fundingLabels:{department:'CEE',pi:'Architecture',other:'Partner'}};const f=transportFixture(initial);const store=createRctStore({transport:f.transport,table:'exampletable'});const oldClient=emptyReview();delete oldClient.other;delete oldClient.fundingLabels;
 const saved=await store.save(row().id,oldClient,'v1','reviewer');assert.equal(saved.row.review.other,7);assert.deepEqual(saved.row.review.fundingLabels,initial.fundingLabels);
});
test('Excel retains contributor names and Other amount without moving note columns',()=>{
 const review={...emptyReview(),award:120,decision:'Support',school:10,department:10,pi:10,other:10,fundingLabels:{department:'CEE',pi:'Architecture',other:'Partner <A>'}};
 const zip=unzipSync(exportReviews(template(),[{...row(),review}])),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.match(sheet,/<c r="W8"[^>]*><v>10<\/v>/);assert.match(sheet,/<c r="X8"[^>]*[\s\S]*?CEE/);assert.match(sheet,/Architecture/);assert.match(sheet,/Partner &lt;A&gt;/);assert.match(sheet,/COUNT\(J8:L8,W8\)/);assert.match(sheet,/SUM\(H8:L8,W8\)/);assert.match(sheet,/<c r="S8"/);
});

test('comment stamps come from the signed-in editor and only change with their own text',async()=>{
 const stamp={by:'first_editor',at:'2026-11-19T15:00:00.000Z'},original={...emptyReview(),notes:'Original note',commentStamps:{notes:stamp,reviewers:[stamp,null,null,null,null,null]}};original.reviewers[0].comments='Original comment';
 const f=transportFixture(original),store=createRctStore({transport:f.transport,table:'exampletable',now:()=>new Date('2026-11-20T15:04:05Z')});
 const changed={...original,notes:'Revised note',commentStamps:{notes:{by:'spoofed',at:'2000-01-01'},reviewers:[null,null,null,null,null,null]}};const saved=(await store.save(row().id,changed,'v1','actual_editor')).row.review;
 assert.deepEqual(saved.commentStamps.notes,{by:'actual_editor',at:'2026-11-20T15:04:05.000Z'});assert.deepEqual(saved.commentStamps.reviewers[0],stamp);assert.equal(saved.notesHistory[0].by,'first_editor');assert.equal(saved.notesHistory[0].at,stamp.at);
 const money=(await store.save(row().id,{...original,school:10},'v1','other_editor')).row.review;assert.deepEqual(money.commentStamps.notes,stamp);assert.deepEqual(money.commentStamps.reviewers[0],stamp);
 const comments=(await store.save(row().id,{...original,reviewers:original.reviewers.map((v,i)=>i? v:{...v,comments:'Updated comment'})},'v1','actual_editor')).row.review;assert.equal(comments.commentStamps.reviewers[0].by,'actual_editor');assert(comments.notesHistory.some(n=>n.text==='Hammond: Original comment'&&n.by==='first_editor'));
});
test('old notes stay unstamped until edited and stamps survive clients that omit metadata',async()=>{
 const legacy=emptyReview();delete legacy.commentStamps;legacy.notes='Existing legacy note';const f=transportFixture(legacy),store=createRctStore({transport:f.transport,table:'exampletable',now:()=>new Date('2026-11-20T15:00:00Z')});
 assert.equal((await store.save(row().id,{...legacy,school:12},'v1','editor')).row.review.commentStamps.notes,null);
 const changed=(await store.save(row().id,{...legacy,notes:'New note'},'v1','editor')).row.review;assert.equal(changed.commentStamps.notes.by,'editor');assert.equal(changed.notesHistory[0].by,'Earlier entry');
 assert.throws(()=>validateReview({...emptyReview(),commentStamps:{notes:{by:'editor',at:'not-a-date'},reviewers:[null,null,null,null,null,null]}}));
 const stamp={by:'editor',at:'2026-11-20T15:04:05.000Z'},review={...emptyReview(),notes:'Example note',commentStamps:{notes:stamp,reviewers:[stamp,null,null,null,null,null]}};review.reviewers[0].comments='Example comment';const output=unzipSync(exportReviews(template(),[{...row(),review}]));assert.match(strFromU8(output['xl/worksheets/sheet1.xml']),/Saved Nov 20, 2026.*10:04:05.*EST.*editor/);assert.match(strFromU8(output['xl/worksheets/rct-review-details.xml']),/Saved Nov 20, 2026.*editor/);
});
