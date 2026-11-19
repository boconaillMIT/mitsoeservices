import test from 'node:test';import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {emptyReview,validateReview,fundingSummary,commitmentView,decisionState,centralThirds,fundingReview,fundingTotal,sortProposals,departmentInfo} from './src/rct-model.mjs';
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
test('RCT Excel maps all 11 proposals, preserves styles, removes links and recalculates local formulas',()=>{
 const rows=Array.from({length:11},(_,i)=>({...row(),id:'FY27-RCT2|fake-'+i,source:{...source,pi:'Example '+String(i).padStart(2,'0'),order:i},review:{...emptyReview(),award:i===0?0:100,school:i===0?null:40,provost:i===0?null:60,decision:'Support',notes:'=NOT_A_FORMULA & <text>'}}));
 const zip=unzipSync(exportReviews(template(),rows)),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<dimension ref="A2:V19"/);assert.match(sheet,/<c r="B18"[^>]*t="inlineStr">[\s\S]*?Example 10/);assert.match(sheet,/<c r="G8"[^>]*><v>0<\/v>/);assert.match(sheet,/<c r="H8"[^>]*><f>ROUND\(IF\(G8="",E8,G8\)\/3,2\)<\/f><v>0<\/v>/);
 assert.match(sheet,/IF\(G18="",E18,G18\)-SUM\(H18:L18\)/);assert.match(sheet,/Calculation basis/);assert.doesNotMatch(sheet,/VPR/);assert.match(sheet,/COUNTA\(B8:B18\)/);assert.match(sheet,/=NOT_A_FORMULA &amp; &lt;text&gt;/);
 assert.match(strFromU8(zip['xl/workbook.xml']),/name="Review details"/);assert.match(strFromU8(zip['xl/worksheets/rct-review-details.xml']),/Overall priority/);assert.match(strFromU8(zip['xl/worksheets/rct-review-details.xml']),/Grade \(1–5\)/);assert.equal(strFromU8(zip['xl/styles.xml']),'unchanged style');assert.ok(!Object.keys(zip).some(k=>k.includes('externalLinks')||k.includes('calcChain')));assert.ok(!strFromU8(zip['xl/tables/table1.xml']).includes('calculatedColumnFormula'));assert.match(strFromU8(zip['xl/tables/table1.xml']),/A7:V18/);
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
